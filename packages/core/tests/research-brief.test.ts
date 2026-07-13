import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildResearchBrief, renderResearchBrief } from "../src/research/brief";
import { SqliteAdapter } from "../src/storage/sqlite-adapter";
import type { RedditItem } from "../src/types";

function makeTempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "reddit-saved-research-"));
  return join(dir, "test.db");
}

function post(
  id: string,
  overrides: Partial<{
    title: string;
    selftext: string;
    subreddit: string;
    score: number;
    created_utc: number;
    author: string;
  }> = {},
): RedditItem {
  return {
    kind: "t3",
    data: {
      id,
      name: `t3_${id}`,
      title: overrides.title ?? `Post ${id}`,
      author: overrides.author ?? "op",
      subreddit: overrides.subreddit ?? "programming",
      permalink: `/r/${overrides.subreddit ?? "programming"}/comments/${id}/post/`,
      created_utc: overrides.created_utc ?? 1_690_000_000,
      score: overrides.score ?? 10,
      selftext: overrides.selftext,
    },
  };
}

function comment(
  id: string,
  parentName: string,
  overrides: Partial<{ body: string; score: number; author: string; created_utc: number }> = {},
): RedditItem {
  return {
    kind: "t1",
    data: {
      id,
      name: `t1_${id}`,
      author: overrides.author ?? `user_${id}`,
      subreddit: "programming",
      permalink: `/r/programming/comments/root/post/${id}/`,
      created_utc: overrides.created_utc ?? 1_690_000_100,
      score: overrides.score ?? 5,
      body: overrides.body ?? `comment ${id}`,
      parent_id: parentName,
    },
  };
}

describe("research briefs", () => {
  let dbPath: string;
  let adapter: SqliteAdapter;

  beforeEach(() => {
    dbPath = makeTempDb();
    adapter = new SqliteAdapter(dbPath);
  });

  afterEach(() => {
    adapter.close();
    rmSync(dirname(dbPath), { recursive: true, force: true });
  });

  test("assembles seeds with threads, links, and subreddit counts", () => {
    adapter.upsertPosts(
      [
        post("seed1", {
          title: "Rust ownership explained",
          selftext: "Deep dive into ownership. More at https://doc.rust-lang.org/book",
        }),
        post("other", { title: "Unrelated cooking thread", subreddit: "cooking" }),
      ],
      "saved",
    );
    adapter.upsertContextItems([
      comment("c1", "t3_seed1", { body: "Ownership clicked for me after this" }),
      comment("c2", "t1_c1", { body: "Same, the borrow checker examples helped" }),
    ]);

    const brief = buildResearchBrief(adapter, "rust ownership");

    expect(brief.seeds).toHaveLength(1);
    expect(brief.seeds[0].post.id).toBe("seed1");
    expect(brief.seeds[0].thread.map((r) => r.id)).toEqual(["seed1", "c1", "c2"]);
    expect(brief.subreddits).toEqual([{ subreddit: "programming", count: 1 }]);
    expect(brief.links).toEqual([
      { canonical_url: "doc.rust-lang.org/book", host: "doc.rust-lang.org", count: 1 },
    ]);
  });

  test("a match already covered by an earlier thread does not repeat", () => {
    adapter.upsertPosts([post("root", { title: "GraphQL versus REST" })], "saved");
    // The comment matches the query too and lives in root's thread
    adapter.upsertPosts([comment("dup", "t3_root", { body: "GraphQL won for our team" })], "saved");

    const brief = buildResearchBrief(adapter, "graphql");
    expect(brief.seeds).toHaveLength(1);
    const ids = brief.seeds[0].thread.map((r) => r.id);
    expect(ids).toContain("dup");
  });

  test("hides low-quality rows by default", () => {
    adapter.upsertPosts(
      [
        post("good", { title: "Zig comptime tricks" }),
        // Standalone bot comment in an unrelated (unstored) thread
        comment("botspam", "t3_elsewhere", { body: "Zig bot reply", author: "AutoModerator" }),
      ],
      "saved",
    );

    const brief = buildResearchBrief(adapter, "zig");
    expect(brief.seeds.map((s) => s.post.id)).toEqual(["good"]);

    const withLowQuality = buildResearchBrief(adapter, "zig", { includeLowQuality: true });
    expect(withLowQuality.seeds.map((s) => s.post.id).sort()).toEqual(["botspam", "good"]);
  });

  test("respects since/until bounds", () => {
    adapter.upsertPosts(
      [
        post("old", { title: "Docker networking basics", created_utc: 1_500_000_000 }),
        post("new", { title: "Docker networking advanced", created_utc: 1_690_000_000 }),
      ],
      "saved",
    );

    const brief = buildResearchBrief(adapter, "docker networking", { since: 1_600_000_000 });
    expect(brief.seeds.map((s) => s.post.id)).toEqual(["new"]);
  });

  test("markdown render is deterministic and carries no timestamp", () => {
    adapter.upsertPosts(
      [
        post("seed1", {
          title: "Rust ownership explained",
          selftext: "Deep dive. https://doc.rust-lang.org/book has more.",
          score: 42,
          created_utc: 1_690_000_000,
        }),
      ],
      "saved",
    );
    adapter.upsertContextItems([
      comment("c1", "t3_seed1", { body: "Ownership clicked for me", score: 7 }),
    ]);

    const render = () => renderResearchBrief(buildResearchBrief(adapter, "rust ownership"));
    const markdown = render();
    expect(render()).toBe(markdown);

    expect(markdown).toContain("# Research: rust ownership");
    expect(markdown).toContain("## 1. Rust ownership explained — r/programming");
    expect(markdown).toContain(
      "[u/op](https://www.reddit.com/r/programming/comments/seed1/post/) · score 42 · 2023-07-22",
    );
    expect(markdown).toContain("Thread:");
    expect(markdown).toContain("- [u/op]");
    expect(markdown).toContain("  - [u/user_c1]");
    expect(markdown).toContain("## Links");
    expect(markdown).toContain("- doc.rust-lang.org/book (1)");
    expect(markdown).toContain("## Subreddits");
    // Snippet highlight markers are rewritten to markdown bold
    expect(markdown).not.toContain("RS_HL");
    // Determinism: no generated-at wording anywhere
    expect(markdown).not.toMatch(/generated|as of \d/i);
  });

  test("long bodies are clipped to ~280 chars", () => {
    const longBody = "flink stream processing ".repeat(30).trim(); // ~720 chars
    adapter.upsertPosts([post("root", { title: "Flink guide" })], "saved");
    adapter.upsertContextItems([comment("long1", "t3_root", { body: longBody, score: 9 })]);

    const markdown = renderResearchBrief(buildResearchBrief(adapter, "flink"));
    const line = markdown.split("\n").find((l) => l.includes("u/user_long1"));
    expect(line).toBeDefined();
    expect(line?.length).toBeLessThan(400);
    expect(line).toContain("…");
  });

  test("empty result set still renders a valid brief", () => {
    const brief = buildResearchBrief(adapter, "nothing matches this");
    const markdown = renderResearchBrief(brief);
    expect(brief.seeds).toEqual([]);
    expect(markdown).toContain("# Research: nothing matches this");
    expect(markdown).toContain("0 match(es)");
  });
});
