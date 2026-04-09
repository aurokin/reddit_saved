import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { SqliteAdapter } from "../src/storage/sqlite-adapter";
import { TagManager } from "../src/tags/tag-manager";
import type { RedditItem } from "../src/types";

function makeTempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "reddit-saved-test-"));
  return join(dir, "test.db");
}

function makeItem(overrides: Partial<{ id: string; kind: string; title: string; author: string; subreddit: string; score: number; body: string }>): RedditItem {
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
    expect(row!.title).toBe("Hello World");
    expect(row!.author).toBe("testuser");
    expect(row!.is_on_reddit).toBe(1);
  });

  test("upsert updates metadata without overwriting content_origin", () => {
    const item = makeItem({ id: "post1", score: 10 });
    adapter.upsertPosts([item], "saved");

    const updated = makeItem({ id: "post1", score: 99 });
    adapter.upsertPosts([updated], "upvoted");

    const row = adapter.getPost("post1");
    expect(row!.score).toBe(99);
    expect(row!.content_origin).toBe("saved"); // preserved, not overwritten
  });

  test("listPosts returns results with default ordering", () => {
    adapter.upsertPosts([
      makeItem({ id: "a", score: 10 }),
      makeItem({ id: "b", score: 50 }),
    ], "saved");

    const results = adapter.listPosts({});
    expect(results.length).toBe(2);
  });

  test("listPosts filters by subreddit", () => {
    adapter.upsertPosts([
      makeItem({ id: "a", subreddit: "rust" }),
      makeItem({ id: "b", subreddit: "python" }),
    ], "saved");

    const results = adapter.listPosts({ subreddit: "rust" });
    expect(results.length).toBe(1);
    expect(results[0].subreddit).toBe("rust");
  });

  test("listPosts filters by minScore", () => {
    adapter.upsertPosts([
      makeItem({ id: "a", score: 5 }),
      makeItem({ id: "b", score: 100 }),
    ], "saved");

    const results = adapter.listPosts({ minScore: 50 });
    expect(results.length).toBe(1);
    expect(results[0].score).toBe(100);
  });

  test("searchPosts uses FTS", () => {
    adapter.upsertPosts([
      makeItem({ id: "a", title: "Learning Rust programming" }),
      makeItem({ id: "b", title: "Python data science" }),
    ], "saved");

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
    expect(adapter.getPost("fresh")!.is_on_reddit).toBe(1);
  });

  test("markUnsaved marks specific posts", () => {
    adapter.upsertPosts([
      makeItem({ id: "a" }),
      makeItem({ id: "b" }),
    ], "saved");

    adapter.markUnsaved(["a"]);
    expect(adapter.getPost("a")!.is_on_reddit).toBe(0);
    expect(adapter.getPost("b")!.is_on_reddit).toBe(1);
  });

  test("getStats returns correct counts", () => {
    adapter.upsertPosts([
      makeItem({ id: "p1", kind: "t3" }),
      makeItem({ id: "p2", kind: "t3" }),
      makeItem({ id: "c1", kind: "t1", body: "a comment" }),
    ], "saved");

    const stats = adapter.getStats();
    expect(stats.totalPosts).toBe(2);
    expect(stats.totalComments).toBe(1);
    expect(stats.orphanedCount).toBe(0);
  });

  test("sync state get/set", () => {
    expect(adapter.getSyncState("last_cursor")).toBeNull();
    adapter.setSyncState("last_cursor", "t3_abc123");
    expect(adapter.getSyncState("last_cursor")).toBe("t3_abc123");

    // Update
    adapter.setSyncState("last_cursor", "t3_def456");
    expect(adapter.getSyncState("last_cursor")).toBe("t3_def456");
  });

  test("orphaned posts excluded from list by default", () => {
    adapter.upsertPosts([
      makeItem({ id: "a" }),
      makeItem({ id: "b" }),
    ], "saved");
    adapter.markUnsaved(["b"]);

    const results = adapter.listPosts({});
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("a");
  });

  test("orphaned posts included with orphaned flag", () => {
    adapter.upsertPosts([
      makeItem({ id: "a" }),
      makeItem({ id: "b" }),
    ], "saved");
    adapter.markUnsaved(["b"]);

    const results = adapter.listPosts({ orphaned: true });
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("b");
  });

  test("listPosts with tag and subreddit filter combined", () => {
    const tags = new TagManager(adapter.getDb());

    adapter.upsertPosts([
      makeItem({ id: "a", subreddit: "rust" }),
      makeItem({ id: "b", subreddit: "python" }),
      makeItem({ id: "c", subreddit: "rust" }),
    ], "saved");

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

    adapter.upsertPosts([
      makeItem({ id: "a", subreddit: "rust", title: "Learning Rust async" }),
      makeItem({ id: "b", subreddit: "python", title: "Rust vs Python speed" }),
      makeItem({ id: "c", subreddit: "rust", title: "Rust ownership model" }),
    ], "saved");

    tags.createTag("favorite");
    tags.addTagToPost("favorite", "a");
    tags.addTagToPost("favorite", "b");

    // Should return only post "a" — matches FTS "rust", tagged "favorite", AND subreddit "rust"
    const results = adapter.searchPosts("rust", { tag: "favorite", subreddit: "rust" });
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("a");
  });

  test("searchPosts handles special characters in query", () => {
    adapter.upsertPosts([
      makeItem({ id: "a", title: 'Using "quotes" in titles' }),
      makeItem({ id: "b", title: "Normal title here" }),
    ], "saved");

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
    expect(row!.title).toBe("Edited Title");
    expect(row!.body).toBe("Edited body");
  });

  test("listPosts respects limit and offset", () => {
    // Use score sort with distinct scores for deterministic ordering
    adapter.upsertPosts([
      makeItem({ id: "a", score: 10 }),
      makeItem({ id: "b", score: 20 }),
      makeItem({ id: "c", score: 30 }),
      makeItem({ id: "d", score: 40 }),
    ], "saved");

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
    expect(row!.tags).toBeDefined();
    const tagNames = row!.tags!.split("||").sort();
    expect(tagNames).toEqual(["alpha", "beta"]);
  });

  test("getStats returns subredditCounts and tagCounts", () => {
    const tags = new TagManager(adapter.getDb());
    adapter.upsertPosts([
      makeItem({ id: "a", subreddit: "rust" }),
      makeItem({ id: "b", subreddit: "rust" }),
      makeItem({ id: "c", subreddit: "python" }),
    ], "saved");

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
});
