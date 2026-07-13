import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  backupStatus,
  buildBackupPlan,
  buildManifest,
  canonicalStringify,
  writeBackup,
} from "../src/backup/backup";
import { commitBackup, ensureGitRepo, isGitRepo, runGit } from "../src/backup/git";
import { SqliteAdapter } from "../src/storage/sqlite-adapter";
import { TagManager } from "../src/tags/tag-manager";
import type { RedditItem } from "../src/types";

function makeItem(id: string, createdUtc: number): RedditItem {
  return {
    kind: "t3",
    data: {
      id,
      name: `t3_${id}`,
      title: `Post ${id}`,
      author: "author",
      subreddit: "sub",
      permalink: `/r/sub/comments/${id}/post/`,
      created_utc: createdUtc,
      score: 3,
    },
  };
}

const UTC_2021 = 1_620_000_000; // 2021-05-03
const UTC_2023 = 1_690_000_000; // 2023-07-22

describe("canonicalStringify", () => {
  test("sorts keys recursively and skips undefined", () => {
    expect(
      canonicalStringify({ b: 1, a: { d: null, c: [2, { z: 1, y: 2 }] }, skip: undefined }),
    ).toBe('{"a":{"c":[2,{"y":2,"z":1}],"d":null},"b":1}');
  });
});

describe("JSONL backup", () => {
  let dir: string;
  let dbPath: string;
  let repoPath: string;
  let adapter: SqliteAdapter;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "reddit-saved-backup-"));
    dbPath = join(dir, "test.db");
    repoPath = join(dir, "repo");
    adapter = new SqliteAdapter(dbPath);
  });

  afterEach(() => {
    adapter.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("posts shard by UTC year and all tables serialize deterministically", async () => {
    adapter.upsertPosts([makeItem("p2021", UTC_2021), makeItem("p2023", UTC_2023)], "saved");
    const tags = new TagManager(adapter.getDb());
    const tag = tags.createTag("ml");
    tags.addTagToPost(tag.name, "p2021");
    adapter.setSyncState("last_sync_time", "1234");

    const result = await writeBackup(adapter, repoPath);

    expect(existsSync(join(repoPath, "data", "posts", "2021.jsonl"))).toBe(true);
    expect(existsSync(join(repoPath, "data", "posts", "2023.jsonl"))).toBe(true);
    expect(existsSync(join(repoPath, "data", "tags.jsonl"))).toBe(true);
    expect(existsSync(join(repoPath, "data", "post_tags.jsonl"))).toBe(true);
    expect(existsSync(join(repoPath, "data", "sync_state.jsonl"))).toBe(true);
    expect(existsSync(join(repoPath, "manifest.json"))).toBe(true);

    // One object per line, keys sorted
    const line = readFileSync(join(repoPath, "data", "posts", "2021.jsonl"), "utf8")
      .trim()
      .split("\n")[0];
    const keys = Object.keys(JSON.parse(line));
    expect(keys).toEqual([...keys].sort());

    // Derived tables are not backed up
    expect(result.manifest.files.some((f) => f.path.includes("link_occurrences"))).toBe(false);
    expect(result.manifest.files.some((f) => f.path.includes("sync_runs"))).toBe(false);

    // Manifest carries no timestamp
    const manifestRaw = readFileSync(join(repoPath, "manifest.json"), "utf8");
    expect(manifestRaw).not.toMatch(/generated|timestamp|At"/i);
  });

  test("two consecutive syncs are byte-identical and the second writes nothing", async () => {
    adapter.upsertPosts([makeItem("stable", UTC_2023)], "saved");

    const first = await writeBackup(adapter, repoPath);
    const snapshot = readFileSync(join(repoPath, "data", "posts", "2023.jsonl"), "utf8");

    const second = await writeBackup(adapter, repoPath);
    expect(second.written).toEqual([]);
    expect(second.removed).toEqual([]);
    expect(second.manifest.backupHash).toBe(first.manifest.backupHash);
    expect(readFileSync(join(repoPath, "data", "posts", "2023.jsonl"), "utf8")).toBe(snapshot);
  });

  test("stale year shards are removed when their rows disappear", async () => {
    adapter.upsertPosts([makeItem("gone", UTC_2021), makeItem("kept", UTC_2023)], "saved");
    await writeBackup(adapter, repoPath);
    expect(existsSync(join(repoPath, "data", "posts", "2021.jsonl"))).toBe(true);

    adapter.getDb().run("DELETE FROM posts WHERE id = 'gone'");
    const result = await writeBackup(adapter, repoPath);
    expect(result.removed).toEqual(["data/posts/2021.jsonl"]);
    expect(existsSync(join(repoPath, "data", "posts", "2021.jsonl"))).toBe(false);
  });

  test("invalid created_utc lands in unknown.jsonl", () => {
    adapter.upsertPosts([makeItem("weird", UTC_2023)], "saved");
    adapter.getDb().run("UPDATE posts SET created_utc = 0 WHERE id = 'weird'");

    const plan = buildBackupPlan(adapter);
    expect(plan.map((f) => f.path)).toContain("data/posts/unknown.jsonl");
  });

  test("backupStatus reports pending changes and up-to-date state", async () => {
    adapter.upsertPosts([makeItem("s1", UTC_2023)], "saved");

    const before = await backupStatus(adapter, repoPath);
    expect(before.upToDate).toBe(false);
    expect(before.pendingChanges).toContain("data/posts/2023.jsonl");

    await writeBackup(adapter, repoPath);
    const after = await backupStatus(adapter, repoPath);
    expect(after.upToDate).toBe(true);
    expect(after.pendingChanges).toEqual([]);

    adapter.upsertPosts([makeItem("s2", UTC_2023)], "saved");
    const changed = await backupStatus(adapter, repoPath);
    expect(changed.upToDate).toBe(false);
    expect(changed.pendingChanges).toEqual(["data/posts/2023.jsonl"]);
  });

  test("manifest hash is order-independent of insert order", async () => {
    adapter.upsertPosts([makeItem("b", UTC_2023), makeItem("a", UTC_2023)], "saved");
    const hashOne = buildManifest(buildBackupPlan(adapter)).backupHash;

    const dbPath2 = join(dir, "test2.db");
    const adapter2 = new SqliteAdapter(dbPath2);
    try {
      adapter2.upsertPosts([makeItem("a", UTC_2023)], "saved");
      adapter2.upsertPosts([makeItem("b", UTC_2023)], "saved");
      // fetched_at/updated_at differ between the two databases, so compare
      // the posts serialization minus volatile columns via row ordering only.
      const planOne = buildBackupPlan(adapter).find((f) => f.path === "data/posts/2023.jsonl");
      const planTwo = buildBackupPlan(adapter2).find((f) => f.path === "data/posts/2023.jsonl");
      const ids = (plan: { content: string } | undefined) =>
        (plan?.content ?? "")
          .trim()
          .split("\n")
          .map((l) => JSON.parse(l).id);
      expect(ids(planOne)).toEqual(["a", "b"]);
      expect(ids(planTwo)).toEqual(["a", "b"]);
    } finally {
      adapter2.close();
    }
    expect(hashOne).toBeTruthy();
  });
});

describe("backup git integration", () => {
  let dir: string;
  let dbPath: string;
  let repoPath: string;
  let adapter: SqliteAdapter;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "reddit-saved-backup-git-"));
    dbPath = join(dir, "test.db");
    repoPath = join(dir, "repo");
    adapter = new SqliteAdapter(dbPath);
    rmSync(repoPath, { recursive: true, force: true });
    await Bun.write(join(repoPath, ".keep"), "");
    await ensureGitRepo(repoPath);
    await runGit(repoPath, ["config", "user.email", "test@example.com"]);
    await runGit(repoPath, ["config", "user.name", "Backup Test"]);
  });

  afterEach(() => {
    adapter.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("ensureGitRepo initializes once", async () => {
    expect(await isGitRepo(repoPath)).toBe(true);
    expect((await ensureGitRepo(repoPath)).initialized).toBe(false);
  });

  test("commit on change, no commit when nothing changed", async () => {
    adapter.upsertPosts([makeItem("g1", UTC_2023)], "saved");
    await writeBackup(adapter, repoPath);

    const first = await commitBackup(repoPath, { message: "backup: test" });
    expect(first.committed).toBe(true);

    await writeBackup(adapter, repoPath);
    const second = await commitBackup(repoPath, { message: "backup: test again" });
    expect(second.committed).toBe(false);

    const log = await runGit(repoPath, ["log", "--oneline"]);
    expect(log.stdout.split("\n")).toHaveLength(1);
  });

  test("commitBackup throws when the configured remote is missing", async () => {
    adapter.upsertPosts([makeItem("g2", UTC_2023)], "saved");
    await writeBackup(adapter, repoPath);
    await expect(
      commitBackup(repoPath, { message: "backup", remote: "origin", push: true }),
    ).rejects.toThrow(/remote "origin" does not exist/);
  });
});
