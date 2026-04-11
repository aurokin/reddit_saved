import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { SqliteAdapter, TagManager } from "@reddit-saved/core";
import { setOutputMode } from "../src/output";
import { captureConsole, captureExit, ExitCaptured, makeItem, makeTempDb } from "./helpers";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("search command", () => {
  let dbPath: string;
  let adapter: SqliteAdapter;

  beforeEach(() => {
    dbPath = makeTempDb();
    adapter = new SqliteAdapter(dbPath);
    setOutputMode(false, false, false);
  });

  afterEach(() => {
    adapter.close();
    rmSync(dirname(dbPath), { recursive: true, force: true });
  });

  test("search returns matching posts as JSON", async () => {
    adapter.upsertPosts(
      [
        makeItem({ id: "p1", title: "Learning Rust programming", subreddit: "rust", score: 100 }),
        makeItem({ id: "p2", title: "Python tutorial", subreddit: "python", score: 50 }),
      ],
      "saved",
    );
    adapter.close();

    const { searchCmd } = await import("../src/commands/search");
    const cap = captureConsole();
    try {
      await searchCmd({ db: dbPath }, ["Rust"]);
      expect(cap.logs.length).toBe(1);
      const results = JSON.parse(cap.logs[0]);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("p1");
      expect(results[0].title).toBe("Learning Rust programming");
    } finally {
      cap.restore();
    }
  });

  test("search with --subreddit filter", async () => {
    adapter.upsertPosts(
      [
        makeItem({ id: "p1", title: "Rust tips", subreddit: "rust" }),
        makeItem({ id: "p2", title: "Rust in Python", subreddit: "python" }),
      ],
      "saved",
    );
    adapter.close();

    const { searchCmd } = await import("../src/commands/search");
    const cap = captureConsole();
    try {
      await searchCmd({ db: dbPath, subreddit: "rust" }, ["Rust"]);
      const results = JSON.parse(cap.logs[0]);
      expect(results.length).toBe(1);
      expect(results[0].subreddit).toBe("rust");
    } finally {
      cap.restore();
    }
  });
});

describe("list command", () => {
  let dbPath: string;
  let adapter: SqliteAdapter;

  beforeEach(() => {
    dbPath = makeTempDb();
    adapter = new SqliteAdapter(dbPath);
    setOutputMode(false, false, false);
  });

  afterEach(() => {
    adapter.close();
    rmSync(dirname(dbPath), { recursive: true, force: true });
  });

  test("list returns all posts as JSON", async () => {
    adapter.upsertPosts(
      [
        makeItem({ id: "p1", title: "Post A", score: 10 }),
        makeItem({ id: "p2", title: "Post B", score: 20 }),
      ],
      "saved",
    );
    adapter.close();

    const { listCmd } = await import("../src/commands/list");
    const cap = captureConsole();
    try {
      await listCmd({ db: dbPath });
      const results = JSON.parse(cap.logs[0]);
      expect(results.length).toBe(2);
    } finally {
      cap.restore();
    }
  });

  test("list with --sort score", async () => {
    adapter.upsertPosts(
      [
        makeItem({ id: "p1", title: "Low", score: 5 }),
        makeItem({ id: "p2", title: "High", score: 500 }),
      ],
      "saved",
    );
    adapter.close();

    const { listCmd } = await import("../src/commands/list");
    const cap = captureConsole();
    try {
      await listCmd({ db: dbPath, sort: "score" });
      const results = JSON.parse(cap.logs[0]);
      expect(results[0].score).toBe(500);
      expect(results[1].score).toBe(5);
    } finally {
      cap.restore();
    }
  });
});

describe("status command", () => {
  let dbPath: string;
  let adapter: SqliteAdapter;

  beforeEach(() => {
    dbPath = makeTempDb();
    adapter = new SqliteAdapter(dbPath);
    setOutputMode(false, false, false);
  });

  afterEach(() => {
    adapter.close();
    rmSync(dirname(dbPath), { recursive: true, force: true });
  });

  test("status returns stats as JSON", async () => {
    adapter.upsertPosts([makeItem({ id: "p1" }), makeItem({ id: "p2" })], "saved");
    adapter.close();

    const { statusCmd } = await import("../src/commands/status");
    const cap = captureConsole();
    try {
      await statusCmd({ db: dbPath });
      const stats = JSON.parse(cap.logs[0]);
      expect(stats.totalPosts).toBe(2);
      expect(stats.totalComments).toBe(0);
      expect(stats.tags).toEqual([]);
    } finally {
      cap.restore();
    }
  });
});

describe("tag commands", () => {
  let dbPath: string;
  let adapter: SqliteAdapter;

  beforeEach(() => {
    dbPath = makeTempDb();
    adapter = new SqliteAdapter(dbPath);
    setOutputMode(false, false, false);
  });

  afterEach(() => {
    adapter.close();
    rmSync(dirname(dbPath), { recursive: true, force: true });
  });

  test("tag create and list", async () => {
    adapter.close();

    const { tagCreate, tagList } = await import("../src/commands/tag");
    const cap = captureConsole();
    try {
      await tagCreate({ db: dbPath }, ["my-tag"]);
      const created = JSON.parse(cap.logs[0]);
      expect(created.name).toBe("my-tag");

      cap.logs.length = 0;
      await tagList({ db: dbPath }, []);
      const tags = JSON.parse(cap.logs[0]);
      expect(tags.length).toBe(1);
      expect(tags[0].name).toBe("my-tag");
    } finally {
      cap.restore();
    }
  });

  test("tag create with --color in JSON mode", async () => {
    adapter.close();

    const { tagCreate } = await import("../src/commands/tag");
    const cap = captureConsole();
    try {
      await tagCreate({ db: dbPath, color: "#ff0000" }, ["colored-tag"]);
      const output = JSON.parse(cap.logs[0]);
      expect(output.name).toBe("colored-tag");
      expect(output.color).toBe("#ff0000");
    } finally {
      cap.restore();
    }
  });

  test("tag add and show", async () => {
    adapter.upsertPosts([makeItem({ id: "p1" })], "saved");
    const tags = new TagManager(adapter.getDb());
    tags.createTag("ml");
    adapter.close();

    const { tagAdd, tagShow } = await import("../src/commands/tag");
    const cap = captureConsole();
    try {
      await tagAdd({ db: dbPath, to: "p1" }, ["ml"]);
      cap.logs.length = 0;

      await tagShow({ db: dbPath }, ["p1"]);
      const postTags = JSON.parse(cap.logs[0]);
      expect(postTags.length).toBe(1);
      expect(postTags[0].name).toBe("ml");
    } finally {
      cap.restore();
    }
  });

  test("tag rename", async () => {
    adapter.close();

    const { tagCreate, tagRename, tagList } = await import("../src/commands/tag");
    const cap = captureConsole();
    try {
      await tagCreate({ db: dbPath }, ["old-name"]);
      cap.logs.length = 0;

      await tagRename({ db: dbPath }, ["old-name", "new-name"]);
      cap.logs.length = 0;

      await tagList({ db: dbPath }, []);
      const tags = JSON.parse(cap.logs[0]);
      expect(tags[0].name).toBe("new-name");
    } finally {
      cap.restore();
    }
  });

  test("tag delete", async () => {
    adapter.close();

    const { tagCreate, tagDelete, tagList } = await import("../src/commands/tag");
    const cap = captureConsole();
    try {
      await tagCreate({ db: dbPath }, ["doomed"]);
      cap.logs.length = 0;

      await tagDelete({ db: dbPath }, ["doomed"]);
      cap.logs.length = 0;

      await tagList({ db: dbPath }, []);
      const tags = JSON.parse(cap.logs[0]);
      expect(tags.length).toBe(0);
    } finally {
      cap.restore();
    }
  });
});

describe("export command", () => {
  let dbPath: string;
  let adapter: SqliteAdapter;

  beforeEach(() => {
    dbPath = makeTempDb();
    adapter = new SqliteAdapter(dbPath);
    setOutputMode(false, false, false);
  });

  afterEach(() => {
    adapter.close();
    rmSync(dirname(dbPath), { recursive: true, force: true });
  });

  test("export to file as JSON", async () => {
    adapter.upsertPosts([makeItem({ id: "p1", title: "Export Test" })], "saved");
    adapter.close();

    const outPath = join(dirname(dbPath), "export.json");
    const { exportCmd } = await import("../src/commands/export");
    const cap = captureConsole();
    try {
      await exportCmd({ db: dbPath, format: "json", output: outPath }, []);
      const content = await Bun.file(outPath).json();
      expect(content.count).toBe(1);
      expect(content.posts[0].title).toBe("Export Test");
    } finally {
      cap.restore();
    }
  });

  test("export as CSV", async () => {
    adapter.upsertPosts([makeItem({ id: "p1", title: "CSV Test" })], "saved");
    adapter.close();

    const outPath = join(dirname(dbPath), "export.csv");
    const { exportCmd } = await import("../src/commands/export");
    const cap = captureConsole();
    try {
      await exportCmd({ db: dbPath, format: "csv", output: outPath }, []);
      const content = await Bun.file(outPath).text();
      expect(content).toContain("CSV Test");
      expect(content).toContain("id,"); // CSV header
    } finally {
      cap.restore();
    }
  });

  test("export as Markdown", async () => {
    adapter.upsertPosts([makeItem({ id: "p1", title: "Markdown Test" })], "saved");
    adapter.close();

    const outPath = join(dirname(dbPath), "export.md");
    const { exportCmd } = await import("../src/commands/export");
    const cap = captureConsole();
    try {
      await exportCmd({ db: dbPath, format: "markdown", output: outPath }, []);
      const content = await Bun.file(outPath).text();
      expect(content).toContain("Markdown Test");
    } finally {
      cap.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// export — filter passthrough
// ---------------------------------------------------------------------------

describe("export command — filter passthrough", () => {
  let dbPath: string;
  let adapter: SqliteAdapter;

  beforeEach(() => {
    dbPath = makeTempDb();
    adapter = new SqliteAdapter(dbPath);
    setOutputMode(false, false, false);
  });

  afterEach(() => {
    adapter.close();
    rmSync(dirname(dbPath), { recursive: true, force: true });
  });

  test("export with --tag filter only includes tagged posts", async () => {
    adapter.upsertPosts(
      [
        makeItem({ id: "p1", title: "Tagged post" }),
        makeItem({ id: "p2", title: "Untagged post" }),
      ],
      "saved",
    );
    const tags = new TagManager(adapter.getDb());
    tags.createTag("important");
    tags.addTagToPost("important", "p1");
    adapter.close();

    const outPath = join(dirname(dbPath), "export.json");
    const { exportCmd } = await import("../src/commands/export");
    const cap = captureConsole();
    try {
      await exportCmd({ db: dbPath, format: "json", output: outPath, tag: "important" }, []);
      const content = await Bun.file(outPath).json();
      expect(content.count).toBe(1);
      expect(content.posts[0].title).toBe("Tagged post");
    } finally {
      cap.restore();
    }
  });

  test("export with --type post excludes comments", async () => {
    adapter.upsertPosts(
      [
        makeItem({ id: "p1", title: "A post", kind: "t3" }),
        makeItem({ id: "c1", body: "A comment", kind: "t1" }),
      ],
      "saved",
    );
    adapter.close();

    const outPath = join(dirname(dbPath), "export.json");
    const { exportCmd } = await import("../src/commands/export");
    const cap = captureConsole();
    try {
      await exportCmd({ db: dbPath, format: "json", output: outPath, type: "post" }, []);
      const content = await Bun.file(outPath).json();
      expect(content.count).toBe(1);
      expect(content.posts[0].id).toBe("p1");
    } finally {
      cap.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// tag remove
// ---------------------------------------------------------------------------

describe("tag remove command", () => {
  let dbPath: string;
  let adapter: SqliteAdapter;

  beforeEach(() => {
    dbPath = makeTempDb();
    adapter = new SqliteAdapter(dbPath);
    setOutputMode(false, false, false);
  });

  afterEach(() => {
    adapter.close();
    rmSync(dirname(dbPath), { recursive: true, force: true });
  });

  test("tag remove removes a tag from a post", async () => {
    adapter.upsertPosts([makeItem({ id: "p1" })], "saved");
    const tags = new TagManager(adapter.getDb());
    tags.createTag("ml");
    tags.addTagToPost("ml", "p1");
    adapter.close();

    const { tagRemove, tagShow } = await import("../src/commands/tag");
    const cap = captureConsole();
    try {
      await tagRemove({ db: dbPath, from: "p1" }, ["ml"]);
      cap.logs.length = 0;

      await tagShow({ db: dbPath }, ["p1"]);
      const postTags = JSON.parse(cap.logs[0]);
      expect(postTags.length).toBe(0);
    } finally {
      cap.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// search — additional filter tests
// ---------------------------------------------------------------------------

describe("search command — additional filters", () => {
  let dbPath: string;
  let adapter: SqliteAdapter;

  beforeEach(() => {
    dbPath = makeTempDb();
    adapter = new SqliteAdapter(dbPath);
    setOutputMode(false, false, false);
  });

  afterEach(() => {
    adapter.close();
    rmSync(dirname(dbPath), { recursive: true, force: true });
  });

  test("search with --type post filters to posts only", async () => {
    adapter.upsertPosts(
      [
        makeItem({ id: "p1", title: "Rust tips", kind: "t3" }),
        makeItem({ id: "c1", title: undefined, body: "Rust comment body", kind: "t1" }),
      ],
      "saved",
    );
    adapter.close();

    const { searchCmd } = await import("../src/commands/search");
    const cap = captureConsole();
    try {
      await searchCmd({ db: dbPath, type: "post" }, ["Rust"]);
      const results = JSON.parse(cap.logs[0]);
      expect(results.length).toBe(1);
      expect(results[0].kind).toBe("post");
    } finally {
      cap.restore();
    }
  });

  test("search with --tag filter", async () => {
    adapter.upsertPosts(
      [
        makeItem({ id: "p1", title: "Tagged Rust post" }),
        makeItem({ id: "p2", title: "Untagged Rust post" }),
      ],
      "saved",
    );
    const tags = new TagManager(adapter.getDb());
    tags.createTag("ml");
    tags.addTagToPost("ml", "p1");
    adapter.close();

    const { searchCmd } = await import("../src/commands/search");
    const cap = captureConsole();
    try {
      await searchCmd({ db: dbPath, tag: "ml" }, ["Rust"]);
      const results = JSON.parse(cap.logs[0]);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("p1");
    } finally {
      cap.restore();
    }
  });

  test("search with --orphaned filter", async () => {
    adapter.upsertPosts(
      [
        makeItem({ id: "p1", title: "Active Rust post" }),
        makeItem({ id: "p2", title: "Orphaned Rust post" }),
      ],
      "saved",
    );
    adapter.getDb().run("UPDATE posts SET is_on_reddit = 0 WHERE id = ?", ["p2"]);
    adapter.close();

    const { searchCmd } = await import("../src/commands/search");
    const cap = captureConsole();
    try {
      await searchCmd({ db: dbPath, orphaned: true }, ["Rust"]);
      const results = JSON.parse(cap.logs[0]);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("p2");
    } finally {
      cap.restore();
    }
  });

  test("search with no query exits with error", async () => {
    adapter.close();

    const { searchCmd } = await import("../src/commands/search");
    const cap = captureConsole();
    const exit = captureExit();
    try {
      await searchCmd({ db: dbPath }, []);
    } catch (e) {
      expect(e).toBeInstanceOf(ExitCaptured);
    } finally {
      exit.restore();
      cap.restore();
    }
    expect(exit.exitCode).toBe(1);
    expect(cap.errors[0]).toContain("Search query required");
  });
});

// ---------------------------------------------------------------------------
// list — additional filter tests
// ---------------------------------------------------------------------------

describe("list command — additional filters", () => {
  let dbPath: string;
  let adapter: SqliteAdapter;

  beforeEach(() => {
    dbPath = makeTempDb();
    adapter = new SqliteAdapter(dbPath);
    setOutputMode(false, false, false);
  });

  afterEach(() => {
    adapter.close();
    rmSync(dirname(dbPath), { recursive: true, force: true });
  });

  test("list with --limit and --offset", async () => {
    adapter.upsertPosts(
      [
        makeItem({ id: "p1", title: "First" }),
        makeItem({ id: "p2", title: "Second" }),
        makeItem({ id: "p3", title: "Third" }),
      ],
      "saved",
    );
    adapter.close();

    const { listCmd } = await import("../src/commands/list");
    const cap = captureConsole();
    try {
      await listCmd({ db: dbPath, limit: "1", offset: "1" });
      const results = JSON.parse(cap.logs[0]);
      expect(results.length).toBe(1);
    } finally {
      cap.restore();
    }
  });

  test("list with --subreddit filter", async () => {
    adapter.upsertPosts(
      [
        makeItem({ id: "p1", title: "Rust post", subreddit: "rust" }),
        makeItem({ id: "p2", title: "Python post", subreddit: "python" }),
      ],
      "saved",
    );
    adapter.close();

    const { listCmd } = await import("../src/commands/list");
    const cap = captureConsole();
    try {
      await listCmd({ db: dbPath, subreddit: "rust" }, []);
      const results = JSON.parse(cap.logs[0]);
      expect(results.length).toBe(1);
      expect(results[0].subreddit).toBe("rust");
    } finally {
      cap.restore();
    }
  });

  test("list with invalid --origin exits with error", async () => {
    adapter.close();

    const { listCmd } = await import("../src/commands/list");
    const cap = captureConsole();
    const exit = captureExit();
    try {
      await listCmd({ db: dbPath, origin: "invalid" });
    } catch (e) {
      expect(e).toBeInstanceOf(ExitCaptured);
    } finally {
      exit.restore();
      cap.restore();
    }
    expect(exit.exitCode).toBe(1);
    expect(cap.errors[0]).toContain("Invalid --origin");
  });

  test("list with --type comment filters to comments", async () => {
    adapter.upsertPosts(
      [
        makeItem({ id: "p1", title: "A post", kind: "t3" }),
        makeItem({ id: "c1", body: "A comment", kind: "t1" }),
      ],
      "saved",
    );
    adapter.close();

    const { listCmd } = await import("../src/commands/list");
    const cap = captureConsole();
    try {
      await listCmd({ db: dbPath, type: "comment" });
      const results = JSON.parse(cap.logs[0]);
      expect(results.length).toBe(1);
      expect(results[0].kind).toBe("comment");
    } finally {
      cap.restore();
    }
  });

  test("list with --author filter", async () => {
    adapter.upsertPosts(
      [
        makeItem({ id: "p1", title: "Alice post", author: "alice" }),
        makeItem({ id: "p2", title: "Bob post", author: "bob" }),
      ],
      "saved",
    );
    adapter.close();

    const { listCmd } = await import("../src/commands/list");
    const cap = captureConsole();
    try {
      await listCmd({ db: dbPath, author: "alice" });
      const results = JSON.parse(cap.logs[0]);
      expect(results.length).toBe(1);
      expect(results[0].author).toBe("alice");
    } finally {
      cap.restore();
    }
  });

  test("list with --min-score filter", async () => {
    adapter.upsertPosts(
      [
        makeItem({ id: "p1", title: "Low", score: 5 }),
        makeItem({ id: "p2", title: "High", score: 100 }),
      ],
      "saved",
    );
    adapter.close();

    const { listCmd } = await import("../src/commands/list");
    const cap = captureConsole();
    try {
      await listCmd({ db: dbPath, "min-score": "50" });
      const results = JSON.parse(cap.logs[0]);
      expect(results.length).toBe(1);
      expect(results[0].score).toBe(100);
    } finally {
      cap.restore();
    }
  });

  test("list with --tag filter", async () => {
    adapter.upsertPosts(
      [makeItem({ id: "p1", title: "Tagged" }), makeItem({ id: "p2", title: "Untagged" })],
      "saved",
    );
    const tags = new TagManager(adapter.getDb());
    tags.createTag("important");
    tags.addTagToPost("important", "p1");
    adapter.close();

    const { listCmd } = await import("../src/commands/list");
    const cap = captureConsole();
    try {
      await listCmd({ db: dbPath, tag: "important" });
      const results = JSON.parse(cap.logs[0]);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("p1");
    } finally {
      cap.restore();
    }
  });

  test("list with --sort-direction asc", async () => {
    adapter.upsertPosts(
      [
        makeItem({ id: "p1", title: "Low", score: 5 }),
        makeItem({ id: "p2", title: "High", score: 500 }),
      ],
      "saved",
    );
    adapter.close();

    const { listCmd } = await import("../src/commands/list");
    const cap = captureConsole();
    try {
      await listCmd({ db: dbPath, sort: "score", "sort-direction": "asc" });
      const results = JSON.parse(cap.logs[0]);
      expect(results[0].score).toBe(5);
      expect(results[1].score).toBe(500);
    } finally {
      cap.restore();
    }
  });

  test("list with invalid --sort exits with error", async () => {
    adapter.close();

    const { listCmd } = await import("../src/commands/list");
    const cap = captureConsole();
    const exit = captureExit();
    try {
      await listCmd({ db: dbPath, sort: "foobar" });
    } catch (e) {
      expect(e).toBeInstanceOf(ExitCaptured);
    } finally {
      exit.restore();
      cap.restore();
    }
    expect(exit.exitCode).toBe(1);
    expect(cap.errors[0]).toContain("Invalid --sort");
  });

  test("list with invalid --sort-direction exits with error", async () => {
    adapter.close();

    const { listCmd } = await import("../src/commands/list");
    const cap = captureConsole();
    const exit = captureExit();
    try {
      await listCmd({ db: dbPath, "sort-direction": "ascending" });
    } catch (e) {
      expect(e).toBeInstanceOf(ExitCaptured);
    } finally {
      exit.restore();
      cap.restore();
    }
    expect(exit.exitCode).toBe(1);
    expect(cap.errors[0]).toContain("Invalid --sort-direction");
  });
});

// ---------------------------------------------------------------------------
// search — more filter tests
// ---------------------------------------------------------------------------

describe("search command — author and min-score filters", () => {
  let dbPath: string;
  let adapter: SqliteAdapter;

  beforeEach(() => {
    dbPath = makeTempDb();
    adapter = new SqliteAdapter(dbPath);
    setOutputMode(false, false, false);
  });

  afterEach(() => {
    adapter.close();
    rmSync(dirname(dbPath), { recursive: true, force: true });
  });

  test("search with --author filter", async () => {
    adapter.upsertPosts(
      [
        makeItem({ id: "p1", title: "Rust by alice", author: "alice" }),
        makeItem({ id: "p2", title: "Rust by bob", author: "bob" }),
      ],
      "saved",
    );
    adapter.close();

    const { searchCmd } = await import("../src/commands/search");
    const cap = captureConsole();
    try {
      await searchCmd({ db: dbPath, author: "alice" }, ["Rust"]);
      const results = JSON.parse(cap.logs[0]);
      expect(results.length).toBe(1);
      expect(results[0].author).toBe("alice");
    } finally {
      cap.restore();
    }
  });

  test("search with --min-score filter", async () => {
    adapter.upsertPosts(
      [
        makeItem({ id: "p1", title: "Rust low", score: 5 }),
        makeItem({ id: "p2", title: "Rust high", score: 200 }),
      ],
      "saved",
    );
    adapter.close();

    const { searchCmd } = await import("../src/commands/search");
    const cap = captureConsole();
    try {
      await searchCmd({ db: dbPath, "min-score": "50" }, ["Rust"]);
      const results = JSON.parse(cap.logs[0]);
      expect(results.length).toBe(1);
      expect(results[0].score).toBe(200);
    } finally {
      cap.restore();
    }
  });

  test("search with --after and --before filters", async () => {
    adapter.upsertPosts(
      [
        makeItem({ id: "old", title: "Rust old", created_utc: 1704067200 }),
        makeItem({ id: "in-range", title: "Rust in range", created_utc: 1704844800 }),
        makeItem({ id: "new", title: "Rust new", created_utc: 1706745600 }),
      ],
      "saved",
    );
    adapter.close();

    const { searchCmd } = await import("../src/commands/search");
    const cap = captureConsole();
    try {
      await searchCmd({ db: dbPath, after: "2024-01-05", before: "2024-01-20" }, ["Rust"]);
      const results = JSON.parse(cap.logs[0]);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("in-range");
    } finally {
      cap.restore();
    }
  });

  test("search with invalid date range throws", async () => {
    adapter.close();

    const { searchCmd } = await import("../src/commands/search");
    const cap = captureConsole();
    try {
      await expect(
        searchCmd({ db: dbPath, after: "2024-02-01", before: "2024-01-01" }, ["Rust"]),
      ).rejects.toThrow("--after must be earlier than or equal to --before");
    } finally {
      cap.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// human mode output tests
// ---------------------------------------------------------------------------

describe("human mode output", () => {
  let dbPath: string;
  let adapter: SqliteAdapter;

  beforeEach(() => {
    dbPath = makeTempDb();
    adapter = new SqliteAdapter(dbPath);
    setOutputMode(true, false, false);
  });

  afterEach(() => {
    adapter.close();
    setOutputMode(false, false, false);
    rmSync(dirname(dbPath), { recursive: true, force: true });
  });

  test("list in human mode shows table headers", async () => {
    adapter.upsertPosts([makeItem({ id: "p1", title: "Test" })], "saved");
    adapter.close();

    const { listCmd } = await import("../src/commands/list");
    const cap = captureConsole();
    try {
      await listCmd({ db: dbPath });
      const allOutput = cap.logs.join("\n");
      expect(allOutput).toContain("item(s)");
      expect(allOutput).toContain("ID");
      expect(allOutput).toContain("Title");
    } finally {
      cap.restore();
    }
  });

  test("search in human mode shows result count", async () => {
    adapter.upsertPosts([makeItem({ id: "p1", title: "Rust tips" })], "saved");
    adapter.close();

    const { searchCmd } = await import("../src/commands/search");
    const cap = captureConsole();
    try {
      await searchCmd({ db: dbPath }, ["Rust"]);
      const allOutput = cap.logs.join("\n");
      expect(allOutput).toContain("result(s) for");
    } finally {
      cap.restore();
    }
  });

  test("status in human mode shows sections", async () => {
    adapter.upsertPosts([makeItem({ id: "p1" })], "saved");
    adapter.close();

    const { statusCmd } = await import("../src/commands/status");
    const cap = captureConsole();
    try {
      await statusCmd({ db: dbPath });
      const allOutput = cap.logs.join("\n");
      expect(allOutput).toContain("Database");
      expect(allOutput).toContain("Posts");
    } finally {
      cap.restore();
    }
  });

  test("status in human mode shows sync time and subreddit counts", async () => {
    adapter.upsertPosts(
      [
        makeItem({ id: "p1", subreddit: "rust" }),
        makeItem({ id: "p2", subreddit: "rust" }),
        makeItem({ id: "p3", subreddit: "python" }),
      ],
      "saved",
    );
    adapter.setSyncState("last_sync_time", String(Date.now() - 60000));
    adapter.close();

    const { statusCmd } = await import("../src/commands/status");
    const cap = captureConsole();
    try {
      await statusCmd({ db: dbPath }, []);
      const allOutput = cap.logs.join("\n");
      expect(allOutput).toContain("Sync");
      expect(allOutput).toContain("Last sync");
      expect(allOutput).toContain("Top Subreddits");
      expect(allOutput).toContain("rust");
      expect(allOutput).toContain("python");
    } finally {
      cap.restore();
    }
  });

  test("tag list in human mode with no tags", async () => {
    adapter.close();

    const { tagList } = await import("../src/commands/tag");
    const cap = captureConsole();
    try {
      await tagList({ db: dbPath }, []);
      expect(cap.logs[0]).toContain("No tags");
    } finally {
      cap.restore();
    }
  });

  test("tag list in human mode with tags shows table", async () => {
    const tags = new TagManager(adapter.getDb());
    tags.createTag("ml", "#ff0000");
    adapter.close();

    const { tagList } = await import("../src/commands/tag");
    const cap = captureConsole();
    try {
      await tagList({ db: dbPath }, []);
      const allOutput = cap.logs.join("\n");
      expect(allOutput).toContain("Name");
      expect(allOutput).toContain("ml");
    } finally {
      cap.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// tag error paths
// ---------------------------------------------------------------------------

describe("tag command error paths", () => {
  let dbPath: string;
  let adapter: SqliteAdapter;

  beforeEach(() => {
    dbPath = makeTempDb();
    adapter = new SqliteAdapter(dbPath);
    setOutputMode(false, false, false);
  });

  afterEach(() => {
    adapter.close();
    rmSync(dirname(dbPath), { recursive: true, force: true });
  });

  test("tagCreate with no name exits with error", async () => {
    adapter.close();
    const { tagCreate } = await import("../src/commands/tag");
    const cap = captureConsole();
    const exit = captureExit();
    try {
      await tagCreate({ db: dbPath }, []);
    } catch (e) {
      expect(e).toBeInstanceOf(ExitCaptured);
    } finally {
      exit.restore();
      cap.restore();
    }
    expect(exit.exitCode).toBe(1);
    expect(cap.errors[0]).toContain("Tag name required");
  });

  test("tagRename with missing args exits with error", async () => {
    adapter.close();
    const { tagRename } = await import("../src/commands/tag");
    const cap = captureConsole();
    const exit = captureExit();
    try {
      await tagRename({ db: dbPath }, []);
    } catch (e) {
      expect(e).toBeInstanceOf(ExitCaptured);
    } finally {
      exit.restore();
      cap.restore();
    }
    expect(exit.exitCode).toBe(1);
    expect(cap.errors[0]).toContain("Usage");
  });

  test("tagRename with only old name exits with error", async () => {
    adapter.close();
    const { tagRename } = await import("../src/commands/tag");
    const cap = captureConsole();
    const exit = captureExit();
    try {
      await tagRename({ db: dbPath }, ["old-only"]);
    } catch (e) {
      expect(e).toBeInstanceOf(ExitCaptured);
    } finally {
      exit.restore();
      cap.restore();
    }
    expect(exit.exitCode).toBe(1);
  });

  test("tagDelete with no name exits with error", async () => {
    adapter.close();
    const { tagDelete } = await import("../src/commands/tag");
    const cap = captureConsole();
    const exit = captureExit();
    try {
      await tagDelete({ db: dbPath }, []);
    } catch (e) {
      expect(e).toBeInstanceOf(ExitCaptured);
    } finally {
      exit.restore();
      cap.restore();
    }
    expect(exit.exitCode).toBe(1);
    expect(cap.errors[0]).toContain("Usage");
  });

  test("tagAdd with no tag name exits with error", async () => {
    adapter.close();
    const { tagAdd } = await import("../src/commands/tag");
    const cap = captureConsole();
    const exit = captureExit();
    try {
      await tagAdd({ db: dbPath }, []);
    } catch (e) {
      expect(e).toBeInstanceOf(ExitCaptured);
    } finally {
      exit.restore();
      cap.restore();
    }
    expect(exit.exitCode).toBe(1);
    expect(cap.errors[0]).toContain("Usage");
  });

  test("tagAdd with no --to exits with error", async () => {
    adapter.close();
    const { tagAdd } = await import("../src/commands/tag");
    const cap = captureConsole();
    const exit = captureExit();
    try {
      await tagAdd({ db: dbPath }, ["mytag"]);
    } catch (e) {
      expect(e).toBeInstanceOf(ExitCaptured);
    } finally {
      exit.restore();
      cap.restore();
    }
    expect(exit.exitCode).toBe(1);
    expect(cap.errors[0]).toContain("--to");
  });

  test("tagRemove with no tag name exits with error", async () => {
    adapter.close();
    const { tagRemove } = await import("../src/commands/tag");
    const cap = captureConsole();
    const exit = captureExit();
    try {
      await tagRemove({ db: dbPath }, []);
    } catch (e) {
      expect(e).toBeInstanceOf(ExitCaptured);
    } finally {
      exit.restore();
      cap.restore();
    }
    expect(exit.exitCode).toBe(1);
    expect(cap.errors[0]).toContain("Usage");
  });

  test("tagRemove with no --from exits with error", async () => {
    adapter.close();
    const { tagRemove } = await import("../src/commands/tag");
    const cap = captureConsole();
    const exit = captureExit();
    try {
      await tagRemove({ db: dbPath }, ["mytag"]);
    } catch (e) {
      expect(e).toBeInstanceOf(ExitCaptured);
    } finally {
      exit.restore();
      cap.restore();
    }
    expect(exit.exitCode).toBe(1);
    expect(cap.errors[0]).toContain("--from");
  });

  test("tagShow with no post ID exits with error", async () => {
    adapter.close();
    const { tagShow } = await import("../src/commands/tag");
    const cap = captureConsole();
    const exit = captureExit();
    try {
      await tagShow({ db: dbPath }, []);
    } catch (e) {
      expect(e).toBeInstanceOf(ExitCaptured);
    } finally {
      exit.restore();
      cap.restore();
    }
    expect(exit.exitCode).toBe(1);
    expect(cap.errors[0]).toContain("Usage");
  });
});

// ---------------------------------------------------------------------------
// export error paths and edge cases
// ---------------------------------------------------------------------------

describe("export command — error paths", () => {
  let dbPath: string;
  let adapter: SqliteAdapter;

  beforeEach(() => {
    dbPath = makeTempDb();
    adapter = new SqliteAdapter(dbPath);
    setOutputMode(false, false, false);
  });

  afterEach(() => {
    adapter.close();
    rmSync(dirname(dbPath), { recursive: true, force: true });
  });

  test("export with invalid --format exits with error", async () => {
    adapter.close();

    const { exportCmd } = await import("../src/commands/export");
    const cap = captureConsole();
    const exit = captureExit();
    try {
      await exportCmd({ db: dbPath, format: "xml" }, []);
    } catch (e) {
      expect(e).toBeInstanceOf(ExitCaptured);
    } finally {
      exit.restore();
      cap.restore();
    }
    expect(exit.exitCode).toBe(1);
    expect(cap.errors[0]).toContain("Invalid --format");
  });

  test("export to stdout when no --output", async () => {
    adapter.upsertPosts([makeItem({ id: "p1", title: "Stdout Test" })], "saved");
    adapter.close();

    const { exportCmd } = await import("../src/commands/export");
    const chunks: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
      return true;
    }) as typeof process.stdout.write;

    const cap = captureConsole();
    try {
      await exportCmd({ db: dbPath, format: "json" }, []);
      const output = chunks.join("");
      expect(output).toContain("Stdout Test");
    } finally {
      process.stdout.write = origWrite;
      cap.restore();
    }
  });

  test("export with --subreddit filter", async () => {
    adapter.upsertPosts(
      [
        makeItem({ id: "p1", title: "Rust post", subreddit: "rust" }),
        makeItem({ id: "p2", title: "Python post", subreddit: "python" }),
      ],
      "saved",
    );
    adapter.close();

    const outPath = join(dirname(dbPath), "filtered.json");
    const { exportCmd } = await import("../src/commands/export");
    const cap = captureConsole();
    try {
      await exportCmd({ db: dbPath, format: "json", output: outPath, subreddit: "rust" }, []);
      const content = await Bun.file(outPath).json();
      expect(content.count).toBe(1);
      expect(content.posts[0].subreddit).toBe("rust");
    } finally {
      cap.restore();
    }
  });

  test("export CSV to stdout", async () => {
    adapter.upsertPosts([makeItem({ id: "p1", title: "CSV Stdout Test" })], "saved");
    adapter.close();

    const { exportCmd } = await import("../src/commands/export");
    const chunks: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
      return true;
    }) as typeof process.stdout.write;

    const cap = captureConsole();
    try {
      await exportCmd({ db: dbPath, format: "csv" }, []);
      const output = chunks.join("");
      expect(output).toContain("CSV Stdout Test");
      expect(output).toContain("id,");
    } finally {
      process.stdout.write = origWrite;
      cap.restore();
    }
  });

  test("export Markdown to stdout", async () => {
    adapter.upsertPosts([makeItem({ id: "p1", title: "Markdown Stdout Test" })], "saved");
    adapter.close();

    const { exportCmd } = await import("../src/commands/export");
    const chunks: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
      return true;
    }) as typeof process.stdout.write;

    const cap = captureConsole();
    try {
      await exportCmd({ db: dbPath, format: "markdown" }, []);
      const output = chunks.join("");
      expect(output).toContain("Markdown Stdout Test");
    } finally {
      process.stdout.write = origWrite;
      cap.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// tag add/remove — multi-ID error handling
// ---------------------------------------------------------------------------

describe("tag add/remove — multi-ID error handling", () => {
  let dbPath: string;
  let adapter: SqliteAdapter;

  beforeEach(() => {
    dbPath = makeTempDb();
    adapter = new SqliteAdapter(dbPath);
    setOutputMode(false, false, false);
  });

  afterEach(() => {
    adapter.close();
    rmSync(dirname(dbPath), { recursive: true, force: true });
  });

  test("tag add with mix of valid and invalid post IDs reports counts", async () => {
    adapter.upsertPosts([makeItem({ id: "p1" })], "saved");
    const tags = new TagManager(adapter.getDb());
    tags.createTag("ml");
    adapter.close();

    const { tagAdd } = await import("../src/commands/tag");
    const cap = captureConsole();
    try {
      await tagAdd({ db: dbPath, to: "p1,nonexistent_id" }, ["ml"]);
      const output = JSON.parse(cap.logs[0]);
      expect(output.succeeded).toBe(1);
      expect(output.failed).toBe(1);
      // Warning about the failed ID should be on stderr
      expect(cap.errors.some((e) => e.includes("nonexistent_id"))).toBe(true);
    } finally {
      cap.restore();
    }
  });

  test("tag remove with mix of valid and invalid post IDs reports counts", async () => {
    adapter.upsertPosts([makeItem({ id: "p1" })], "saved");
    const tags = new TagManager(adapter.getDb());
    tags.createTag("ml");
    tags.addTagToPost("ml", "p1");
    adapter.close();

    const { tagRemove } = await import("../src/commands/tag");
    const cap = captureConsole();
    try {
      await tagRemove({ db: dbPath, from: "p1,nonexistent_id" }, ["ml"]);
      const output = JSON.parse(cap.logs[0]);
      // Both should succeed since remove is a no-op for non-existent associations
      // but the post ID itself needs to be valid in the tags system
      expect(output.succeeded + output.failed).toBe(2);
    } finally {
      cap.restore();
    }
  });

  test("tag add with comma-separated --to", async () => {
    adapter.upsertPosts([makeItem({ id: "p1" }), makeItem({ id: "p2" })], "saved");
    const tags = new TagManager(adapter.getDb());
    tags.createTag("ml");
    adapter.close();

    const { tagAdd, tagShow } = await import("../src/commands/tag");
    const cap = captureConsole();
    try {
      await tagAdd({ db: dbPath, to: "p1,p2" }, ["ml"]);
      const output = JSON.parse(cap.logs[0]);
      expect(output.succeeded).toBe(2);

      cap.logs.length = 0;
      await tagShow({ db: dbPath }, ["p1"]);
      const tags1 = JSON.parse(cap.logs[0]);
      expect(tags1.length).toBe(1);
      expect(tags1[0].name).toBe("ml");

      cap.logs.length = 0;
      await tagShow({ db: dbPath }, ["p2"]);
      const tags2 = JSON.parse(cap.logs[0]);
      expect(tags2.length).toBe(1);
    } finally {
      cap.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// human mode — tag subcommands
// ---------------------------------------------------------------------------

describe("tag commands — human mode", () => {
  let dbPath: string;
  let adapter: SqliteAdapter;

  beforeEach(() => {
    dbPath = makeTempDb();
    adapter = new SqliteAdapter(dbPath);
    setOutputMode(true, false, false);
  });

  afterEach(() => {
    adapter.close();
    setOutputMode(false, false, false);
    rmSync(dirname(dbPath), { recursive: true, force: true });
  });

  test("tag create in human mode", async () => {
    adapter.close();
    const { tagCreate } = await import("../src/commands/tag");
    const cap = captureConsole();
    try {
      await tagCreate({ db: dbPath }, ["my-tag"]);
      expect(cap.errors[0]).toContain('Created tag "my-tag"');
    } finally {
      cap.restore();
    }
  });

  test("tag create with --color in human mode", async () => {
    adapter.close();
    const { tagCreate } = await import("../src/commands/tag");
    const cap = captureConsole();
    try {
      await tagCreate({ db: dbPath, color: "#ff0000" }, ["colored-tag"]);
      expect(cap.errors[0]).toContain("colored-tag");
      expect(cap.errors[0]).toContain("#ff0000");
    } finally {
      cap.restore();
    }
  });

  test("tag rename in human mode", async () => {
    const tags = new TagManager(adapter.getDb());
    tags.createTag("old-name");
    adapter.close();

    const { tagRename } = await import("../src/commands/tag");
    const cap = captureConsole();
    try {
      await tagRename({ db: dbPath }, ["old-name", "new-name"]);
      expect(cap.errors[0]).toContain("old-name");
      expect(cap.errors[0]).toContain("new-name");
    } finally {
      cap.restore();
    }
  });

  test("tag delete in human mode", async () => {
    const tags = new TagManager(adapter.getDb());
    tags.createTag("doomed");
    adapter.close();

    const { tagDelete } = await import("../src/commands/tag");
    const cap = captureConsole();
    try {
      await tagDelete({ db: dbPath }, ["doomed"]);
      expect(cap.errors[0]).toContain('Deleted tag "doomed"');
    } finally {
      cap.restore();
    }
  });

  test("tag show in human mode with tags", async () => {
    adapter.upsertPosts([makeItem({ id: "p1" })], "saved");
    const tags = new TagManager(adapter.getDb());
    tags.createTag("ml");
    tags.createTag("rust");
    tags.addTagToPost("ml", "p1");
    tags.addTagToPost("rust", "p1");
    adapter.close();

    const { tagShow } = await import("../src/commands/tag");
    const cap = captureConsole();
    try {
      await tagShow({ db: dbPath }, ["p1"]);
      const output = cap.logs[0];
      expect(output).toContain("p1");
      expect(output).toContain("ml");
      expect(output).toContain("rust");
    } finally {
      cap.restore();
    }
  });

  test("tag show in human mode with no tags", async () => {
    adapter.upsertPosts([makeItem({ id: "p1" })], "saved");
    adapter.close();

    const { tagShow } = await import("../src/commands/tag");
    const cap = captureConsole();
    try {
      await tagShow({ db: dbPath }, ["p1"]);
      expect(cap.logs[0]).toContain("No tags");
    } finally {
      cap.restore();
    }
  });

  test("tag add in human mode", async () => {
    adapter.upsertPosts([makeItem({ id: "p1" })], "saved");
    const tags = new TagManager(adapter.getDb());
    tags.createTag("ml");
    adapter.close();

    const { tagAdd } = await import("../src/commands/tag");
    const cap = captureConsole();
    try {
      await tagAdd({ db: dbPath, to: "p1" }, ["ml"]);
      expect(cap.errors[0]).toContain("Tagged");
      expect(cap.errors[0]).toContain("ml");
    } finally {
      cap.restore();
    }
  });

  test("tag remove in human mode", async () => {
    adapter.upsertPosts([makeItem({ id: "p1" })], "saved");
    const tags = new TagManager(adapter.getDb());
    tags.createTag("ml");
    tags.addTagToPost("ml", "p1");
    adapter.close();

    const { tagRemove } = await import("../src/commands/tag");
    const cap = captureConsole();
    try {
      await tagRemove({ db: dbPath, from: "p1" }, ["ml"]);
      expect(cap.errors[0]).toContain("Removed");
      expect(cap.errors[0]).toContain("ml");
    } finally {
      cap.restore();
    }
  });
});
