import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildTodayDigest, renderTodayDigest } from "../src/research/today";
import { SqliteAdapter } from "../src/storage/sqlite-adapter";
import type { InboxItemRow, RedditItem } from "../src/types";

const NOW = 1_800_000_000_000; // fixed epoch ms
const DAY = 24 * 60 * 60 * 1000;

function makeTempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "reddit-cached-today-"));
  return join(dir, "test.db");
}

function makeItem(
  id: string,
  overrides: Partial<{ kind: string; title: string; score: number; url: string }> = {},
): RedditItem {
  const kind = overrides.kind ?? "t3";
  return {
    kind,
    data: {
      id,
      name: `${kind}_${id}`,
      title: overrides.title ?? `Post ${id}`,
      author: "author",
      subreddit: "testsub",
      permalink: `/r/testsub/comments/${id}/post/`,
      created_utc: Math.floor((NOW - 2 * DAY) / 1000),
      score: overrides.score ?? 10,
      url: overrides.url,
    },
  };
}

function makeInboxRow(id: string, createdUtcSeconds: number, isNew = 1): InboxItemRow {
  return {
    id,
    name: `t1_${id}`,
    kind: "t1",
    type: "comment_reply",
    author: "replier",
    subject: "comment reply",
    body: "hi",
    dest: "me",
    subreddit: "testsub",
    context: null,
    link_title: "A post",
    parent_id: null,
    first_message_name: null,
    created_utc: createdUtcSeconds,
    is_new: isNew,
    fetched_at: NOW,
    updated_at: NOW,
    raw_json: "{}",
  };
}

describe("buildTodayDigest", () => {
  let dbPath: string;
  let storage: SqliteAdapter;

  beforeEach(() => {
    dbPath = makeTempDb();
    storage = new SqliteAdapter(dbPath);
  });

  afterEach(() => {
    storage.close();
    rmSync(dirname(dbPath), { recursive: true, force: true });
  });

  test("empty database renders without crashing", () => {
    const digest = buildTodayDigest(storage, { now: NOW });
    expect(digest.newByOrigin.every((o) => o.count === 0)).toBe(true);
    expect(digest.inbox.newCount).toBe(0);
    expect(digest.jobs.lastRun).toBeNull();

    const markdown = renderTodayDigest(digest);
    expect(markdown).toContain("# Today: last 24h");
    expect(markdown).toContain("Nothing new reached the archive");
    expect(markdown).toContain("No new replies, mentions, or messages.");
    expect(markdown).toContain("No sync runs recorded yet");
  });

  test("windows on fetched_at, not created_utc", () => {
    // Both items were created two days ago on Reddit; only the row whose
    // fetched_at falls inside the window counts as new-to-archive.
    storage.upsertPosts([makeItem("inside")], "saved");
    storage.upsertPosts([makeItem("outside")], "saved");
    storage.getDb().run("UPDATE posts SET fetched_at = ? WHERE id = 'inside'", [NOW - DAY / 2]);
    storage.getDb().run("UPDATE posts SET fetched_at = ? WHERE id = 'outside'", [NOW - 3 * DAY]);

    const digest = buildTodayDigest(storage, { now: NOW });
    const saved = digest.newByOrigin.find((o) => o.origin === "saved");
    expect(saved?.count).toBe(1);
    expect(saved?.top[0].id).toBe("inside");
  });

  test("boundary: fetched exactly at window start counts, one ms earlier does not", () => {
    storage.upsertPosts([makeItem("edge"), makeItem("early")], "saved");
    storage.getDb().run("UPDATE posts SET fetched_at = ? WHERE id = 'edge'", [NOW - DAY]);
    storage.getDb().run("UPDATE posts SET fetched_at = ? WHERE id = 'early'", [NOW - DAY - 1]);

    const saved = buildTodayDigest(storage, { now: NOW }).newByOrigin.find(
      (o) => o.origin === "saved",
    );
    expect(saved?.count).toBe(1);
    expect(saved?.top[0].id).toBe("edge");
  });

  test("inbox windows on created_utc with unread first", () => {
    storage.upsertInboxItems([
      makeInboxRow("recent-read", Math.floor((NOW - DAY / 2) / 1000), 0),
      makeInboxRow("recent-unread", Math.floor((NOW - DAY / 4) / 1000), 1),
      makeInboxRow("old-unread", Math.floor((NOW - 5 * DAY) / 1000), 1),
    ]);

    const digest = buildTodayDigest(storage, { now: NOW });
    expect(digest.inbox.newCount).toBe(2);
    expect(digest.inbox.unreadCount).toBe(2);
    expect(digest.inbox.items[0].isNew).toBe(true);
  });

  test("sync health flags stale origins", () => {
    const fresh = storage.startSyncRun("saved", "incremental");
    storage.finishSyncRun(fresh, { status: "complete", fetched: 10 });
    const old = storage.startSyncRun("upvoted", "incremental");
    storage.finishSyncRun(old, { status: "complete", fetched: 5 });
    storage.getDb().run("UPDATE sync_runs SET finished_at = ? WHERE id = ?", [NOW - 5 * DAY, old]);
    storage.getDb().run("UPDATE sync_runs SET finished_at = ? WHERE id = ?", [NOW - 1000, fresh]);

    const digest = buildTodayDigest(storage, { now: NOW });
    expect(digest.syncHealth.find((s) => s.origin === "saved")?.stale).toBe(false);
    expect(digest.syncHealth.find((s) => s.origin === "upvoted")?.stale).toBe(true);
  });

  test("reports the last pipeline run including failed steps", () => {
    const id = storage.startJobRun("launchd");
    storage.finishJobRun(id, {
      status: "errored",
      steps: [
        { step: "fetch", ok: true, durationMs: 100 },
        { step: "inbox", ok: false, durationMs: 5, error: "boom" },
      ],
    });

    const digest = buildTodayDigest(storage, { now: NOW });
    expect(digest.jobs.lastRun?.status).toBe("errored");

    const markdown = renderTodayDigest(digest);
    expect(markdown).toContain("Last pipeline run: errored");
    expect(markdown).toContain("failed: inbox");
  });

  test("deterministic: identical state and now render identical markdown", () => {
    storage.upsertPosts([makeItem("a"), makeItem("b", { kind: "t1" })], "saved");
    storage.upsertInboxItems([makeInboxRow("i1", Math.floor((NOW - DAY / 3) / 1000))]);

    const first = renderTodayDigest(buildTodayDigest(storage, { now: NOW }));
    const second = renderTodayDigest(buildTodayDigest(storage, { now: NOW }));
    expect(first).toBe(second);
  });
});
