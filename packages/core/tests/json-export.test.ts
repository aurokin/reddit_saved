import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { exportToCsv, exportToJson, exportToMarkdown } from "../src/storage/json-export";
import { SqliteAdapter } from "../src/storage/sqlite-adapter";
import { TagManager } from "../src/tags/tag-manager";
import type { RedditItem } from "../src/types";

function makeTempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "reddit-saved-export-test-"));
  return join(dir, "test.db");
}

function makeItem(
  overrides: Partial<{
    id: string;
    kind: string;
    title: string | undefined;
    author: string;
    subreddit: string;
    score: number;
    selftext: string;
    body: string;
  }>,
): RedditItem {
  const id = overrides.id ?? "abc123";
  return {
    kind: overrides.kind ?? "t3",
    data: {
      id,
      name: `${overrides.kind ?? "t3"}_${id}`,
      title: "title" in overrides ? overrides.title : "Test post",
      author: overrides.author ?? "testuser",
      subreddit: overrides.subreddit ?? "test",
      permalink: `/r/test/comments/${id}/test_post/`,
      created_utc: 1700000000,
      score: overrides.score ?? 42,
      selftext: overrides.selftext,
      body: overrides.body,
    },
  };
}

describe("exportToJson", () => {
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

  test("exports empty database", () => {
    const result = JSON.parse(exportToJson(adapter));
    expect(result.count).toBe(0);
    expect(result.posts).toEqual([]);
    expect(result.exportedAt).toBeDefined();
  });

  test("exports posts without raw_json by default", () => {
    adapter.upsertPosts([makeItem({ id: "p1" })], "saved");
    const result = JSON.parse(exportToJson(adapter));
    expect(result.count).toBe(1);
    expect(result.posts[0].id).toBe("p1");
    expect(result.posts[0].raw_json).toBeUndefined();
  });

  test("includes raw_json when requested", () => {
    adapter.upsertPosts([makeItem({ id: "p1" })], "saved");
    const result = JSON.parse(exportToJson(adapter, { includeRawJson: true }));
    expect(result.posts[0].raw_json).toBeDefined();
  });

  test("filters by subreddit", () => {
    adapter.upsertPosts(
      [makeItem({ id: "p1", subreddit: "rust" }), makeItem({ id: "p2", subreddit: "python" })],
      "saved",
    );
    const result = JSON.parse(exportToJson(adapter, { subreddit: "rust" }));
    expect(result.count).toBe(1);
    expect(result.posts[0].subreddit).toBe("rust");
  });

  test("filters by kind", () => {
    adapter.upsertPosts(
      [
        makeItem({ id: "p1", kind: "t3", title: "A post" }),
        makeItem({ id: "c1", kind: "t1", body: "A comment" }),
      ],
      "saved",
    );
    const result = JSON.parse(exportToJson(adapter, { kind: "t1" }));
    expect(result.count).toBe(1);
    expect(result.posts[0].kind).toBe("t1");
  });

  test("filters by tag", () => {
    adapter.upsertPosts(
      [makeItem({ id: "p1", subreddit: "rust" }), makeItem({ id: "p2", subreddit: "python" })],
      "saved",
    );
    const tags = new TagManager(adapter.getDb());
    tags.createTag("ml");
    tags.addTagToPost("ml", "p1");
    const result = JSON.parse(exportToJson(adapter, { tag: "ml" }));
    expect(result.count).toBe(1);
    expect(result.posts[0].id).toBe("p1");
    expect(result.posts[0].tags).toContain("ml");
  });

  test("filters by orphaned status", () => {
    adapter.upsertPosts([makeItem({ id: "p1" }), makeItem({ id: "p2" })], "saved");
    // Mark p2 as orphaned via direct SQL
    adapter.getDb().run("UPDATE posts SET is_on_reddit = 0 WHERE id = ?", ["p2"]);

    const result = JSON.parse(exportToJson(adapter, { orphaned: true }));
    expect(result.count).toBe(1);
    expect(result.posts[0].id).toBe("p2");
  });

  test("default export excludes orphaned posts", () => {
    adapter.upsertPosts([makeItem({ id: "p1" }), makeItem({ id: "p2" })], "saved");
    adapter.getDb().run("UPDATE posts SET is_on_reddit = 0 WHERE id = ?", ["p2"]);

    // No options → adapter defaults to non-orphaned only
    const result = JSON.parse(exportToJson(adapter));
    expect(result.count).toBe(1);
    expect(result.posts[0].id).toBe("p1");
  });

  test("excludes raw_json with explicit includeRawJson: false", () => {
    adapter.upsertPosts([makeItem({ id: "p1" })], "saved");
    const result = JSON.parse(exportToJson(adapter, { includeRawJson: false }));
    expect(result.posts[0].raw_json).toBeUndefined();
  });
});

describe("exportToCsv", () => {
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

  test("exports header row for empty database", () => {
    const csv = exportToCsv(adapter);
    // Trailing CRLF per RFC 4180 — filter empty trailing element from split
    const lines = csv.split("\r\n").filter(Boolean);
    expect(lines.length).toBe(1);
    expect(lines[0]).toBe("id,kind,title,author,subreddit,score,created_utc,permalink,url,tags");
  });

  test("exports data rows with correct field positions", () => {
    adapter.upsertPosts([makeItem({ id: "p1", title: "Hello", score: 99 })], "saved");
    const csv = exportToCsv(adapter);
    const lines = csv.split("\r\n").filter(Boolean);
    expect(lines.length).toBe(2);
    // NOTE: naive split(",") works here because no field contains commas.
    // For tests with commas in fields, use the dedicated escaping test instead.
    const fields = lines[1].split(",");
    expect(fields[0]).toBe("p1"); // id
    expect(fields[1]).toBe("t3"); // kind
    expect(fields[2]).toBe("Hello"); // title
    expect(fields[3]).toBe("testuser"); // author
    expect(fields[4]).toBe("test"); // subreddit
    expect(fields[5]).toBe("99"); // score
  });

  test("escapes commas and quotes in CSV fields", () => {
    adapter.upsertPosts([makeItem({ id: "p1", title: 'Hello, "world"' })], "saved");
    const csv = exportToCsv(adapter);
    const lines = csv.split("\r\n").filter(Boolean);
    // Title field should be wrapped in quotes with internal quotes doubled
    expect(lines[1]).toContain('"Hello, ""world"""');
  });

  test("normalizes bare LF to CRLF in CSV fields", () => {
    adapter.upsertPosts([makeItem({ id: "p1", title: "Line1\nLine2" })], "saved");
    const csv = exportToCsv(adapter);
    expect(csv).toContain('"Line1\r\nLine2"');
  });

  test("normalizes bare CR to CRLF in CSV fields", () => {
    adapter.upsertPosts([makeItem({ id: "p1", title: "Line1\rLine2" })], "saved");
    const csv = exportToCsv(adapter);
    expect(csv).toContain('"Line1\r\nLine2"');
  });
});

describe("exportToMarkdown", () => {
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

  test("exports header for empty database", () => {
    const md = exportToMarkdown(adapter);
    expect(md).toContain("# Reddit Saved Export");
    expect(md).toContain("0 items");
  });

  test("exports post with metadata", () => {
    adapter.upsertPosts(
      [makeItem({ id: "p1", title: "My Post", author: "alice", subreddit: "rust", score: 100 })],
      "saved",
    );
    const md = exportToMarkdown(adapter);
    expect(md).toContain("## My Post");
    expect(md).toContain("- **Subreddit:** r/rust");
    expect(md).toContain("- **Author:** u/alice");
    expect(md).toContain("- **Score:** 100");
    expect(md).toContain("1 items");
  });

  test("exports selftext content as blockquote", () => {
    adapter.upsertPosts([makeItem({ id: "p1", selftext: "This is the body text" })], "saved");
    const md = exportToMarkdown(adapter);
    expect(md).toContain("> This is the body text");
  });

  test("exports comment with fallback title", () => {
    adapter.upsertPosts(
      [makeItem({ id: "c1", kind: "t1", title: undefined, body: "A comment", author: "bob" })],
      "saved",
    );
    const md = exportToMarkdown(adapter);
    expect(md).toContain("## Comment by bob");
    expect(md).toContain("> A comment");
  });

  test("includes tags when present", () => {
    adapter.upsertPosts([makeItem({ id: "p1" })], "saved");
    const tags = new TagManager(adapter.getDb());
    tags.createTag("ml");
    tags.addTagToPost("ml", "p1");
    const md = exportToMarkdown(adapter);
    expect(md).toContain("**Tags:** ml");
  });

  test("blockquotes body content to prevent injection", () => {
    adapter.upsertPosts([makeItem({ id: "p1", selftext: "## Fake Heading\n---\nEvil" })], "saved");
    const md = exportToMarkdown(adapter);
    // Body should be blockquoted, not raw
    expect(md).toContain("> ## Fake Heading");
    expect(md).toContain("> ---");
    expect(md).toContain("> Evil");
  });

  test("wraps link URL in angle brackets", () => {
    adapter.upsertPosts([makeItem({ id: "p1" })], "saved");
    const md = exportToMarkdown(adapter);
    expect(md).toContain("- **Link:** <https://reddit.com/r/test/comments/p1/test_post/>");
  });

  test("sanitizes title to strip Markdown metacharacters", () => {
    adapter.upsertPosts([makeItem({ id: "p1", title: "[Click me](http://evil.com)" })], "saved");
    const md = exportToMarkdown(adapter);
    // Square brackets and parens should be stripped from the heading
    expect(md).toContain("## Click mehttp://evil.com");
    expect(md).not.toContain("[Click me]");
  });
});
