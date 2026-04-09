import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { REDDIT_MAX_ITEMS } from "../src/constants";
import { SqliteAdapter } from "../src/storage/sqlite-adapter";
import { detectOrphans } from "../src/sync/diff";
import type { RedditItem } from "../src/types";

function makeTempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "reddit-saved-diff-test-"));
  return join(dir, "test.db");
}

function makeItem(id: string, subreddit = "test"): RedditItem {
  return {
    kind: "t3",
    data: {
      id,
      name: `t3_${id}`,
      title: `Post ${id}`,
      author: "testuser",
      subreddit,
      permalink: `/r/${subreddit}/comments/${id}/`,
      created_utc: 1700000000,
      score: 10,
    },
  };
}

describe("detectOrphans", () => {
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

  test("marks items as orphaned when last_seen_at < syncStartTime", () => {
    // Insert items with old timestamps (Date.now() at insert time)
    adapter.upsertPosts([makeItem("old1"), makeItem("old2")], "saved");

    // Simulate time passing — syncStartTime is in the future relative to insert
    const syncStartTime = Date.now() + 5000;

    const result = detectOrphans(adapter, syncStartTime);
    expect(result.orphanedCount).toBe(2);
    expect(result.skippedOrigins).toEqual([]);

    // Verify items are actually marked orphaned in DB
    const stats = adapter.getStats();
    expect(stats.orphanedCount).toBe(2);
  });

  test("does not orphan items seen after syncStartTime", () => {
    adapter.upsertPosts([makeItem("fresh1")], "saved");

    // syncStartTime is before insertion
    const syncStartTime = Date.now() - 5000;

    const result = detectOrphans(adapter, syncStartTime);
    expect(result.orphanedCount).toBe(0);
  });

  test("skips origins at or above REDDIT_MAX_ITEMS active count", () => {
    // We need to simulate having >= 1000 active items for "saved" origin.
    // Instead of inserting 1000 items, we'll manipulate the DB directly.
    adapter.upsertPosts([makeItem("p1")], "saved");

    // Directly set the count high by inserting many rows via raw SQL.
    // This couples to the DB schema but avoids inserting 999 RedditItems
    // through adapter.upsertPosts, which would be prohibitively slow.
    const db = adapter.getDb();
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO posts (id, name, kind, content_origin, author, subreddit, permalink, created_utc, score, fetched_at, updated_at, is_on_reddit, last_seen_at, raw_json)
       VALUES (?, ?, 't3', 'saved', 'user', 'test', '/r/test/', 1700000000, 1, ?, ?, 1, ?, '{}')`,
    );

    // p1 is already inserted above — insert the remaining (REDDIT_MAX_ITEMS - 1) rows
    const now = Date.now();
    db.transaction(() => {
      for (let i = 0; i < REDDIT_MAX_ITEMS - 1; i++) {
        stmt.run(`bulk${i}`, `t3_bulk${i}`, now, now, now);
      }
    })();

    // Verify inserted count to catch OR IGNORE silently dropping rows
    const count = db
      .query("SELECT COUNT(*) as c FROM posts WHERE content_origin = 'saved'")
      .get() as { c: number };
    expect(count.c).toBe(REDDIT_MAX_ITEMS);

    const syncStartTime = Date.now() + 5000;
    const result = detectOrphans(adapter, syncStartTime);

    expect(result.skippedOrigins).toContain("saved");
    expect(result.reason).toContain("saved");
    expect(result.reason).toContain(String(REDDIT_MAX_ITEMS));
  });

  test("returns 0 orphaned for empty database", () => {
    const result = detectOrphans(adapter, Date.now());
    expect(result.orphanedCount).toBe(0);
    expect(result.skippedOrigins).toEqual([]);
  });

  test("only orphans items from non-saturated origins", () => {
    // Insert one "upvoted" item (below threshold — will be checked)
    adapter.upsertPosts([makeItem("up1")], "upvoted");

    const syncStartTime = Date.now() + 5000;
    const result = detectOrphans(adapter, syncStartTime);

    // "upvoted" is below threshold, so its item should be orphaned
    expect(result.orphanedCount).toBe(1);
  });
});
