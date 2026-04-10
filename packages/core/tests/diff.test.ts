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

  test("orphans submitted-origin items", () => {
    adapter.upsertPosts([makeItem("sub1")], "submitted");
    const syncStartTime = Date.now() + 5000;
    const result = detectOrphans(adapter, syncStartTime);
    expect(result.orphanedCount).toBe(1);
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

  test("multiple origins in mixed states simultaneously", () => {
    // "upvoted" has old items (below threshold — should be orphaned)
    adapter.upsertPosts([makeItem("up1"), makeItem("up2")], "upvoted");

    // "commented" has old items (below threshold — should be orphaned)
    adapter.upsertPosts([makeItem("com1")], "commented");

    // Saturate "saved" with REDDIT_MAX_ITEMS items
    const db = adapter.getDb();
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO posts (id, name, kind, content_origin, author, subreddit, permalink, created_utc, score, fetched_at, updated_at, is_on_reddit, last_seen_at, raw_json)
       VALUES (?, ?, 't3', 'saved', 'user', 'test', '/r/test/', 1700000000, 1, ?, ?, 1, ?, '{}')`,
    );
    const now = Date.now();
    db.transaction(() => {
      for (let i = 0; i < REDDIT_MAX_ITEMS; i++) {
        stmt.run(`saved${i}`, `t3_saved${i}`, now, now, now);
      }
    })();

    // "submitted" has 0 items — nothing to orphan

    const syncStartTime = Date.now() + 5000;
    const result = detectOrphans(adapter, syncStartTime);

    // "saved" should be skipped (saturated)
    expect(result.skippedOrigins).toContain("saved");
    expect(result.skippedOrigins).not.toContain("upvoted");
    expect(result.skippedOrigins).not.toContain("commented");
    expect(result.skippedOrigins).not.toContain("submitted");

    // "upvoted" (2) + "commented" (1) should be orphaned
    expect(result.orphanedCount).toBe(3);

    // Reason should mention "saved"
    expect(result.reason).toContain("saved");
  });

  test("per-origin correctness: saturated origin items stay active", () => {
    // "upvoted" has 2 old items (will be orphaned)
    adapter.upsertPosts([makeItem("up1"), makeItem("up2")], "upvoted");

    // Saturate "saved" with REDDIT_MAX_ITEMS items via raw SQL
    const db = adapter.getDb();
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO posts (id, name, kind, content_origin, author, subreddit, permalink, created_utc, score, fetched_at, updated_at, is_on_reddit, last_seen_at, raw_json)
       VALUES (?, ?, 't3', 'saved', 'user', 'test', '/r/test/', 1700000000, 1, ?, ?, 1, ?, '{}')`,
    );
    const now = Date.now();
    db.transaction(() => {
      for (let i = 0; i < REDDIT_MAX_ITEMS; i++) {
        stmt.run(`sav${i}`, `t3_sav${i}`, now, now, now);
      }
    })();

    const syncStartTime = Date.now() + 5000;
    detectOrphans(adapter, syncStartTime);

    // Verify upvoted items are orphaned
    expect(adapter.getPost("up1")?.is_on_reddit).toBe(0);
    expect(adapter.getPost("up2")?.is_on_reddit).toBe(0);

    // Verify saved items are NOT orphaned (origin was skipped)
    expect(adapter.getPost("sav0")?.is_on_reddit).toBe(1);
    expect(adapter.getPost("sav500")?.is_on_reddit).toBe(1);
    expect(adapter.getPost("sav999")?.is_on_reddit).toBe(1);
  });

  test("all origins saturated — no orphans detected, all skipped", () => {
    const db = adapter["db"];
    const now = Date.now();
    const stmt = db.prepare(
      "INSERT INTO posts (id, name, kind, content_origin, author, subreddit, permalink, score, created_utc, fetched_at, updated_at, last_seen_at, raw_json, is_on_reddit) VALUES (?, ?, 't3', ?, 'u', 's', '/r/s/', 1, 1, ?, ?, ?, '{}', 1)",
    );

    // Fill saved and upvoted to 1000 each
    db.transaction(() => {
      for (let i = 0; i < REDDIT_MAX_ITEMS; i++) {
        stmt.run(`sav${i}`, `t3_sav${i}`, "saved", now, now, now);
        stmt.run(`upv${i}`, `t3_upv${i}`, "upvoted", now, now, now);
      }
    })();

    const syncStartTime = Date.now() + 5000;
    const result = detectOrphans(adapter, syncStartTime);

    expect(result.orphanedCount).toBe(0);
    expect(result.skippedOrigins).toContain("saved");
    expect(result.skippedOrigins).toContain("upvoted");
    expect(result.reason).toBeDefined();
    expect(result.reason).toContain("saved");
    expect(result.reason).toContain("upvoted");
  });

  test("mixed origins — only unsaturated origins are checked", () => {
    const db = adapter["db"];
    const oldTime = Date.now() - 10000;
    const stmt = db.prepare(
      "INSERT INTO posts (id, name, kind, content_origin, author, subreddit, permalink, score, created_utc, fetched_at, updated_at, last_seen_at, raw_json, is_on_reddit) VALUES (?, ?, 't3', ?, 'u', 's', '/r/s/', 1, 1, ?, ?, ?, '{}', 1)",
    );

    // Saturate saved (1000 items)
    db.transaction(() => {
      for (let i = 0; i < REDDIT_MAX_ITEMS; i++) {
        stmt.run(`sav${i}`, `t3_sav${i}`, "saved", oldTime, oldTime, oldTime);
      }
    })();

    // Add a few unsaturated upvoted items with old timestamps
    stmt.run("upv1", "t3_upv1", "upvoted", oldTime, oldTime, oldTime);
    stmt.run("upv2", "t3_upv2", "upvoted", oldTime, oldTime, oldTime);
    // Add a submitted item with recent timestamp
    const recentTime = Date.now();
    stmt.run("sub1", "t3_sub1", "submitted", recentTime, recentTime, recentTime);

    const syncStartTime = Date.now() + 1000;
    const result = detectOrphans(adapter, syncStartTime);

    // Saved is skipped (saturated), unsaturated origins are checked
    expect(result.skippedOrigins).toContain("saved");
    expect(result.skippedOrigins).not.toContain("upvoted");
    expect(result.skippedOrigins).not.toContain("submitted");
    // upv1, upv2, and sub1 all have last_seen_at < syncStartTime — all orphaned
    expect(result.orphanedCount).toBe(3);
    expect(adapter.getPost("upv1")?.is_on_reddit).toBe(0);
    expect(adapter.getPost("upv2")?.is_on_reddit).toBe(0);
    expect(adapter.getPost("sub1")?.is_on_reddit).toBe(0);
    // Saved items untouched (origin was skipped)
    expect(adapter.getPost("sav0")?.is_on_reddit).toBe(1);
  });

  test("boundary: exactly REDDIT_MAX_ITEMS - 1 active items — origin is NOT skipped", () => {
    const db = adapter.getDb();
    const now = Date.now();
    const stmt = db.prepare(
      "INSERT INTO posts (id, name, kind, content_origin, author, subreddit, permalink, score, created_utc, fetched_at, updated_at, last_seen_at, raw_json, is_on_reddit) VALUES (?, ?, 't3', 'saved', 'u', 's', '/r/s/', 1, 1, ?, ?, ?, '{}', 1)",
    );

    db.transaction(() => {
      for (let i = 0; i < REDDIT_MAX_ITEMS - 1; i++) {
        stmt.run(`b${i}`, `t3_b${i}`, now, now, now);
      }
    })();

    const count = db
      .query("SELECT COUNT(*) as c FROM posts WHERE content_origin = 'saved' AND is_on_reddit = 1")
      .get() as { c: number };
    expect(count.c).toBe(REDDIT_MAX_ITEMS - 1);

    const syncStartTime = Date.now() + 5000;
    const result = detectOrphans(adapter, syncStartTime);

    // 999 items should NOT be skipped — origin is under the limit
    expect(result.skippedOrigins).not.toContain("saved");
    expect(result.orphanedCount).toBe(REDDIT_MAX_ITEMS - 1);
  });

  test("orphaned items are excluded from activeCountByOrigin", () => {
    const db = adapter.getDb();
    const now = Date.now();
    const stmt = db.prepare(
      "INSERT INTO posts (id, name, kind, content_origin, author, subreddit, permalink, score, created_utc, fetched_at, updated_at, last_seen_at, raw_json, is_on_reddit) VALUES (?, ?, 't3', 'saved', 'u', 's', '/r/s/', 1, 1, ?, ?, ?, '{}', ?)",
    );

    // Insert 999 active + 1 orphaned = 1000 total, but only 999 active
    db.transaction(() => {
      for (let i = 0; i < REDDIT_MAX_ITEMS - 1; i++) {
        stmt.run(`a${i}`, `t3_a${i}`, now, now, now, 1); // active
      }
      stmt.run("orphan1", "t3_orphan1", now, now, now, 0); // orphaned
    })();

    const stats = adapter.getStats();
    // activeCountByOrigin should only count is_on_reddit=1, so 999 not 1000
    expect(stats.activeCountByOrigin.saved).toBe(REDDIT_MAX_ITEMS - 1);

    // Therefore orphan detection should NOT skip "saved"
    const syncStartTime = Date.now() + 5000;
    const result = detectOrphans(adapter, syncStartTime);
    expect(result.skippedOrigins).not.toContain("saved");
  });

  test("respects origins parameter — only checks specified origins", () => {
    adapter.upsertPosts([makeItem("s1")], "saved");
    adapter.upsertPosts([makeItem("u1")], "upvoted");

    const syncStartTime = Date.now() + 5000;
    // Only check "saved", leave "upvoted" alone
    const result = detectOrphans(adapter, syncStartTime, ["saved"]);

    expect(result.orphanedCount).toBe(1); // only s1 orphaned
    expect(adapter.getPost("s1")?.is_on_reddit).toBe(0);
    expect(adapter.getPost("u1")?.is_on_reddit).toBe(1); // untouched
  });

  test("default (no origins param) checks all 4 origins", () => {
    adapter.upsertPosts([makeItem("s1")], "saved");
    adapter.upsertPosts([makeItem("u1")], "upvoted");
    adapter.upsertPosts([makeItem("sub1")], "submitted");
    adapter.upsertPosts([makeItem("c1")], "commented");

    const syncStartTime = Date.now() + 5000;
    const result = detectOrphans(adapter, syncStartTime);

    // All 4 items from all origins should be orphaned
    expect(result.orphanedCount).toBe(4);
    expect(adapter.getPost("s1")?.is_on_reddit).toBe(0);
    expect(adapter.getPost("u1")?.is_on_reddit).toBe(0);
    expect(adapter.getPost("sub1")?.is_on_reddit).toBe(0);
    expect(adapter.getPost("c1")?.is_on_reddit).toBe(0);
  });

  test("empty origins array checks nothing", () => {
    adapter.upsertPosts([makeItem("s1")], "saved");
    adapter.upsertPosts([makeItem("u1")], "upvoted");

    const syncStartTime = Date.now() + 5000;
    const result = detectOrphans(adapter, syncStartTime, []);

    expect(result.orphanedCount).toBe(0);
    expect(result.skippedOrigins).toEqual([]);
    // Items remain active
    expect(adapter.getPost("s1")?.is_on_reddit).toBe(1);
    expect(adapter.getPost("u1")?.is_on_reddit).toBe(1);
  });

  test("scoping prevents false orphaning after single-origin sync", () => {
    // Scenario: user has items from both "saved" and "upvoted".
    // They run `fetch --type saved` which only syncs "saved".
    // Without scoping, detectOrphans would falsely orphan "upvoted" items.
    adapter.upsertPosts([makeItem("s1"), makeItem("s2")], "saved");
    adapter.upsertPosts([makeItem("u1"), makeItem("u2")], "upvoted");

    const syncStartTime = Date.now() + 5000;

    // CORRECT: scope to only the synced origin
    const scoped = detectOrphans(adapter, syncStartTime, ["saved"]);
    expect(scoped.orphanedCount).toBe(2); // only saved items
    expect(adapter.getPost("u1")?.is_on_reddit).toBe(1); // upvoted untouched
    expect(adapter.getPost("u2")?.is_on_reddit).toBe(1);
  });
});
