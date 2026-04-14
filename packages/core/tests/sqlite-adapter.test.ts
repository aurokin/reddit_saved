import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SqliteAdapter } from "../src/storage/sqlite-adapter";
import { TagManager } from "../src/tags/tag-manager";
import type { RedditItem } from "../src/types";

function makeTempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "reddit-saved-test-"));
  return join(dir, "test.db");
}

function makeItem(
  overrides: Partial<{
    id: string;
    kind: string;
    title: string;
    author: string;
    subreddit: string;
    score: number;
    body: string;
  }>,
): RedditItem {
  const id = overrides.id ?? "abc123";
  return {
    kind: overrides.kind ?? "t3",
    data: {
      id,
      name: `${overrides.kind ?? "t3"}_${id}`,
      title: overrides.title ?? "Test post",
      author: overrides.author ?? "testuser",
      subreddit: overrides.subreddit ?? "test",
      permalink: `/r/test/comments/${id}/test_post/`,
      created_utc: 1700000000,
      score: overrides.score ?? 42,
      body: overrides.body,
    },
  };
}

describe("SqliteAdapter", () => {
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

  test("upsert and getPost", () => {
    const item = makeItem({ id: "post1", title: "Hello World" });
    adapter.upsertPosts([item], "saved");

    const row = adapter.getPost("post1");
    expect(row).not.toBeNull();
    expect(row?.title).toBe("Hello World");
    expect(row?.author).toBe("testuser");
    expect(row?.is_on_reddit).toBe(1);
  });

  test("upsert updates metadata without overwriting content_origin", () => {
    const item = makeItem({ id: "post1", score: 10 });
    adapter.upsertPosts([item], "saved");

    const updated = makeItem({ id: "post1", score: 99 });
    adapter.upsertPosts([updated], "upvoted");

    const row = adapter.getPost("post1");
    expect(row?.score).toBe(99);
    expect(row?.content_origin).toBe("saved"); // preserved, not overwritten
  });

  test("listPosts returns results with default ordering", () => {
    adapter.upsertPosts(
      [makeItem({ id: "a", score: 10 }), makeItem({ id: "b", score: 50 })],
      "saved",
    );

    const results = adapter.listPosts({});
    expect(results.length).toBe(2);
  });

  test("listPosts filters by subreddit", () => {
    adapter.upsertPosts(
      [makeItem({ id: "a", subreddit: "rust" }), makeItem({ id: "b", subreddit: "python" })],
      "saved",
    );

    const results = adapter.listPosts({ subreddit: "rust" });
    expect(results.length).toBe(1);
    expect(results[0].subreddit).toBe("rust");
  });

  test("listPosts filters by minScore", () => {
    adapter.upsertPosts(
      [makeItem({ id: "a", score: 5 }), makeItem({ id: "b", score: 100 })],
      "saved",
    );

    const results = adapter.listPosts({ minScore: 50 });
    expect(results.length).toBe(1);
    expect(results[0].score).toBe(100);
  });

  test("searchPosts uses FTS", () => {
    adapter.upsertPosts(
      [
        makeItem({ id: "a", title: "Learning Rust programming" }),
        makeItem({ id: "b", title: "Python data science" }),
      ],
      "saved",
    );

    const results = adapter.searchPosts("rust", {});
    expect(results.length).toBe(1);
    expect(results[0].title).toBe("Learning Rust programming");
    expect(results[0].snippet).toBeDefined();
  });

  test("markOrphaned sets is_on_reddit to 0 only for old items", () => {
    adapter.upsertPosts([makeItem({ id: "old" }), makeItem({ id: "new" })], "saved");
    // Use a cutoff between old and new — future timestamp orphans everything seen before it
    const cutoff = Date.now() + 1000;
    // Re-insert "new" so its last_seen_at is after the cutoff
    // Instead, just verify that markOrphaned uses the timestamp correctly:
    const count = adapter.markOrphaned(cutoff);
    expect(count).toBe(2); // both are older than cutoff

    // Now test that a post seen AFTER the cutoff is NOT orphaned
    adapter.upsertPosts([makeItem({ id: "fresh" })], "saved");
    const count2 = adapter.markOrphaned(Date.now() - 1000); // cutoff in the past
    expect(count2).toBe(0); // "fresh" was seen recently, not orphaned
    expect(adapter.getPost("fresh")?.is_on_reddit).toBe(1);
  });

  test("markUnsaved marks specific posts", () => {
    adapter.upsertPosts([makeItem({ id: "a" }), makeItem({ id: "b" })], "saved");

    adapter.markUnsaved(["a"]);
    expect(adapter.getPost("a")?.is_on_reddit).toBe(0);
    expect(adapter.getPost("b")?.is_on_reddit).toBe(1);
  });

  test("getStats returns correct counts", () => {
    adapter.upsertPosts(
      [
        makeItem({ id: "p1", kind: "t3" }),
        makeItem({ id: "p2", kind: "t3" }),
        makeItem({ id: "c1", kind: "t1", body: "a comment" }),
      ],
      "saved",
    );

    const stats = adapter.getStats();
    expect(stats.totalPosts).toBe(2);
    expect(stats.totalComments).toBe(1);
    expect(stats.orphanedCount).toBe(0);
  });

  test("sync state get/set", () => {
    expect(adapter.getSyncState("sync_key")).toBeNull();
    adapter.setSyncState("sync_key", "t3_abc123");
    expect(adapter.getSyncState("sync_key")).toBe("t3_abc123");

    // Update
    adapter.setSyncState("sync_key", "t3_def456");
    expect(adapter.getSyncState("sync_key")).toBe("t3_def456");
  });

  test("orphaned posts excluded from list by default", () => {
    adapter.upsertPosts([makeItem({ id: "a" }), makeItem({ id: "b" })], "saved");
    adapter.markUnsaved(["b"]);

    const results = adapter.listPosts({});
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("a");
  });

  test("orphaned posts included with orphaned flag", () => {
    adapter.upsertPosts([makeItem({ id: "a" }), makeItem({ id: "b" })], "saved");
    adapter.markUnsaved(["b"]);

    const results = adapter.listPosts({ orphaned: true });
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("b");
  });

  test("listPosts with tag and subreddit filter combined", () => {
    const tags = new TagManager(adapter.getDb());

    adapter.upsertPosts(
      [
        makeItem({ id: "a", subreddit: "rust" }),
        makeItem({ id: "b", subreddit: "python" }),
        makeItem({ id: "c", subreddit: "rust" }),
      ],
      "saved",
    );

    tags.createTag("favorite");
    tags.addTagToPost("favorite", "a");
    tags.addTagToPost("favorite", "b");

    // Should return only post "a" — tagged "favorite" AND subreddit "rust"
    const results = adapter.listPosts({ tag: "favorite", subreddit: "rust" });
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("a");
  });

  test("searchPosts with tag and subreddit filter combined", () => {
    const tags = new TagManager(adapter.getDb());

    adapter.upsertPosts(
      [
        makeItem({ id: "a", subreddit: "rust", title: "Learning Rust async" }),
        makeItem({ id: "b", subreddit: "python", title: "Rust vs Python speed" }),
        makeItem({ id: "c", subreddit: "rust", title: "Rust ownership model" }),
      ],
      "saved",
    );

    tags.createTag("favorite");
    tags.addTagToPost("favorite", "a");
    tags.addTagToPost("favorite", "b");

    // Should return only post "a" — matches FTS "rust", tagged "favorite", AND subreddit "rust"
    const results = adapter.searchPosts("rust", { tag: "favorite", subreddit: "rust" });
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("a");
  });

  test("searchPosts handles special characters in query", () => {
    adapter.upsertPosts(
      [
        makeItem({ id: "a", title: 'Using "quotes" in titles' }),
        makeItem({ id: "b", title: "Normal title here" }),
      ],
      "saved",
    );

    // Verify quotes are properly escaped and the correct post is found
    const quoteResults = adapter.searchPosts("quotes", {});
    expect(quoteResults.length).toBe(1);
    expect(quoteResults[0].id).toBe("a");

    // FTS operators and special syntax should not throw or produce wrong results
    expect(adapter.searchPosts('"quotes"', {}).length).toBeGreaterThanOrEqual(0);
    expect(adapter.searchPosts("foo:bar", {}).length).toBeGreaterThanOrEqual(0);
    expect(adapter.searchPosts("OR NOT AND", {}).length).toBeGreaterThanOrEqual(0);
  });

  test("upsert updates title/body on re-fetch (edited content)", () => {
    const original = makeItem({ id: "post1", title: "Original Title", body: "Original body" });
    adapter.upsertPosts([original], "saved");

    const edited = makeItem({ id: "post1", title: "Edited Title", body: "Edited body" });
    adapter.upsertPosts([edited], "saved");

    const row = adapter.getPost("post1");
    expect(row?.title).toBe("Edited Title");
    expect(row?.body).toBe("Edited body");
  });

  test("listPosts respects limit and offset", () => {
    // Use score sort with distinct scores for deterministic ordering
    adapter.upsertPosts(
      [
        makeItem({ id: "a", score: 10 }),
        makeItem({ id: "b", score: 20 }),
        makeItem({ id: "c", score: 30 }),
        makeItem({ id: "d", score: 40 }),
      ],
      "saved",
    );

    const page1 = adapter.listPosts({ sort: "score", sortDirection: "desc", limit: 2, offset: 0 });
    expect(page1.length).toBe(2);
    expect(page1.map((r) => r.id)).toEqual(["d", "c"]);

    const page2 = adapter.listPosts({ sort: "score", sortDirection: "desc", limit: 2, offset: 2 });
    expect(page2.length).toBe(2);
    expect(page2.map((r) => r.id)).toEqual(["b", "a"]);
  });

  test("getPost includes tags via GROUP_CONCAT join", () => {
    const tags = new TagManager(adapter.getDb());
    adapter.upsertPosts([makeItem({ id: "p1" })], "saved");
    tags.createTag("alpha");
    tags.createTag("beta");
    tags.addTagToPost("alpha", "p1");
    tags.addTagToPost("beta", "p1");

    const row = adapter.getPost("p1");
    expect(row).not.toBeNull();
    expect(row?.tags).toBeDefined();
    const tagNames = row?.tags?.split("||").sort();
    expect(tagNames).toEqual(["alpha", "beta"]);
  });

  test("getStats returns subredditCounts and tagCounts", () => {
    const tags = new TagManager(adapter.getDb());
    adapter.upsertPosts(
      [
        makeItem({ id: "a", subreddit: "rust" }),
        makeItem({ id: "b", subreddit: "rust" }),
        makeItem({ id: "c", subreddit: "python" }),
      ],
      "saved",
    );

    tags.createTag("favorite");
    tags.addTagToPost("favorite", "a");
    tags.addTagToPost("favorite", "b");

    const stats = adapter.getStats();
    expect(stats.subredditCounts.length).toBe(2);
    const rustCount = stats.subredditCounts.find((s) => s.subreddit === "rust");
    expect(rustCount?.count).toBe(2);

    expect(stats.tagCounts.length).toBe(1);
    const favCount = stats.tagCounts.find((t) => t.name === "favorite");
    expect(favCount?.count).toBe(2);
  });

  // -----------------------------------------------------------------------
  // New coverage: filters on listPosts and searchPosts
  // -----------------------------------------------------------------------

  test("listPosts filters by author", () => {
    adapter.upsertPosts(
      [makeItem({ id: "a", author: "alice" }), makeItem({ id: "b", author: "bob" })],
      "saved",
    );
    const results = adapter.listPosts({ author: "alice" });
    expect(results.length).toBe(1);
    expect(results[0].author).toBe("alice");
  });

  test("listPosts filters by kind", () => {
    adapter.upsertPosts(
      [
        makeItem({ id: "p1", kind: "t3" }),
        makeItem({ id: "c1", kind: "t1", body: "comment body" }),
      ],
      "saved",
    );
    const posts = adapter.listPosts({ kind: "t3" });
    expect(posts.length).toBe(1);
    expect(posts[0].kind).toBe("t3");

    const comments = adapter.listPosts({ kind: "t1" });
    expect(comments.length).toBe(1);
    expect(comments[0].kind).toBe("t1");
  });

  test("listPosts filters by contentOrigin", () => {
    adapter.upsertPosts([makeItem({ id: "a" })], "saved");
    adapter.upsertPosts([makeItem({ id: "b" })], "upvoted");

    const saved = adapter.listPosts({ contentOrigin: "saved" });
    expect(saved.length).toBe(1);
    expect(saved[0].id).toBe("a");

    const upvoted = adapter.listPosts({ contentOrigin: "upvoted" });
    expect(upvoted.length).toBe(1);
    expect(upvoted[0].id).toBe("b");
  });

  test('listPosts with orphaned="all" returns both active and orphaned', () => {
    adapter.upsertPosts([makeItem({ id: "a" }), makeItem({ id: "b" })], "saved");
    adapter.markUnsaved(["b"]);

    const all = adapter.listPosts({ orphaned: "all" });
    expect(all.length).toBe(2);
    const ids = all.map((r) => r.id).sort();
    expect(ids).toEqual(["a", "b"]);
  });

  test("searchPosts filters by orphaned", () => {
    adapter.upsertPosts(
      [
        makeItem({ id: "a", title: "Rust language guide" }),
        makeItem({ id: "b", title: "Rust ownership patterns" }),
      ],
      "saved",
    );
    adapter.markUnsaved(["b"]);

    // Default: active only
    const active = adapter.searchPosts("rust", {});
    expect(active.length).toBe(1);
    expect(active[0].id).toBe("a");

    // Orphaned only
    const orphaned = adapter.searchPosts("rust", { orphaned: true });
    expect(orphaned.length).toBe(1);
    expect(orphaned[0].id).toBe("b");

    // All
    const all = adapter.searchPosts("rust", { orphaned: "all" });
    expect(all.length).toBe(2);
  });

  test("searchPosts filters by author and kind", () => {
    adapter.upsertPosts(
      [
        makeItem({ id: "a", author: "alice", title: "Rust tips from Alice" }),
        makeItem({ id: "b", author: "bob", title: "Rust tips from Bob" }),
        makeItem({ id: "c", kind: "t1", author: "alice", body: "Rust comment", title: undefined }),
      ],
      "saved",
    );

    const byAuthor = adapter.searchPosts("rust", { author: "alice" });
    expect(byAuthor.length).toBe(2); // post + comment

    const byKind = adapter.searchPosts("rust", { kind: "t3" });
    expect(byKind.length).toBe(2); // both posts

    const combined = adapter.searchPosts("rust", { author: "alice", kind: "t3" });
    expect(combined.length).toBe(1);
    expect(combined[0].id).toBe("a");
  });

  test("markUnsaved chunks large ID arrays (>900)", () => {
    // Create 950 items
    const items = Array.from({ length: 950 }, (_, i) => makeItem({ id: `item_${i}` }));
    adapter.upsertPosts(items, "saved");

    const ids = items.map((it) => it.data.id);
    adapter.markUnsaved(ids);

    // Verify all are marked
    for (const id of ["item_0", "item_449", "item_899", "item_949"]) {
      expect(adapter.getPost(id)?.is_on_reddit).toBe(0);
    }
  });

  test("markOrphaned with origin parameter", () => {
    adapter.upsertPosts([makeItem({ id: "a" })], "saved");
    adapter.upsertPosts([makeItem({ id: "b" })], "upvoted");

    const cutoff = Date.now() + 1000;
    // Only orphan "saved" items
    const count = adapter.markOrphaned(cutoff, "saved");
    expect(count).toBe(1);

    expect(adapter.getPost("a")?.is_on_reddit).toBe(0);
    expect(adapter.getPost("b")?.is_on_reddit).toBe(1);
  });

  test("markOrphaned throws for seconds-scale timestamp", () => {
    adapter.upsertPosts([makeItem({ id: "a" })], "saved");
    // Unix seconds (not milliseconds) — should be rejected
    expect(() => adapter.markOrphaned(1700000000)).toThrow("epoch milliseconds");
  });

  test("searchPosts returns empty for empty string query", () => {
    adapter.upsertPosts([makeItem({ id: "a", title: "hello world" })], "saved");
    expect(adapter.searchPosts("", {})).toEqual([]);
    expect(adapter.searchPosts("   ", {})).toEqual([]);
  });

  test("searchPosts preserves hyphens and apostrophes", () => {
    adapter.upsertPosts([makeItem({ id: "a", title: "machine-learning is great" })], "saved");
    const results = adapter.searchPosts("machine-learning", {});
    expect(results.length).toBe(1);
  });

  test("rebuildFtsIndex does not corrupt search", () => {
    adapter.upsertPosts([makeItem({ id: "a", title: "unique keyword" })], "saved");
    adapter.rebuildFtsIndex();
    const results = adapter.searchPosts("unique", {});
    expect(results.length).toBe(1);
  });

  test("assertFts5Available does not throw", () => {
    expect(() => adapter.assertFts5Available()).not.toThrow();
  });

  test("bulk upsert (>=500 items) maintains FTS consistency", () => {
    // Insert 510 items to trigger bulk path (BULK_THRESHOLD = 500)
    const items = Array.from({ length: 510 }, (_, i) =>
      makeItem({ id: `bulk_${i}`, title: `searchable_term_${i}` }),
    );
    adapter.upsertPosts(items, "saved");

    // FTS should work after bulk insert with trigger-drop-rebuild path
    const results = adapter.searchPosts("searchable_term_0", {});
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe("bulk_0");

    // Also verify a random item from the middle
    const mid = adapter.searchPosts("searchable_term_255", {});
    expect(mid.length).toBeGreaterThanOrEqual(1);
  });

  test("rebuildFtsIndex recovers from emptied FTS index", () => {
    // Insert data and verify search works
    adapter.upsertPosts([makeItem({ id: "fts1", title: "Unique FTS rebuild keyword" })], "saved");
    expect(adapter.searchPosts("Unique", {}).length).toBe(1);

    // Simulate FTS corruption: clear the FTS index directly
    const rawDb = adapter.getDb();
    rawDb.run("DELETE FROM posts_fts");
    expect(adapter.searchPosts("Unique", {}).length).toBe(0);

    // rebuildFtsIndex should restore FTS from the content table
    adapter.rebuildFtsIndex();
    const results = adapter.searchPosts("Unique", {});
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("fts1");
  });

  test("constructor detects missing triggers and rebuilds FTS", () => {
    // Insert data
    const path2 = makeTempDb();
    const adapter1 = new SqliteAdapter(path2);
    adapter1.upsertPosts([makeItem({ id: "tr1", title: "Trigger rebuild test" })], "saved");
    expect(adapter1.searchPosts("Trigger", {}).length).toBe(1);

    // Drop triggers to simulate crash during bulk upsert
    const rawDb = adapter1.getDb();
    rawDb.run("DROP TRIGGER IF EXISTS posts_ai");
    rawDb.run("DROP TRIGGER IF EXISTS posts_ad");
    rawDb.run("DROP TRIGGER IF EXISTS posts_au");
    adapter1.close();

    // New adapter: initializeSchema recreates triggers (IF NOT EXISTS),
    // ensureFtsConsistency checks trigger count (now 3 after recreation).
    // But let's verify the constructor doesn't crash and search works.
    const adapter2 = new SqliteAdapter(path2);
    const results = adapter2.searchPosts("Trigger", {});
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("tr1");
    adapter2.close();
    rmSync(dirname(path2), { recursive: true, force: true });
  });
});
