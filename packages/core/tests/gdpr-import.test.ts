import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RedditApiClient, type TokenProvider } from "../src/api/client";
import { importGdprExport } from "../src/import/gdpr-import";
import { RequestQueue } from "../src/queue/request-queue";
import { SqliteAdapter } from "../src/storage/sqlite-adapter";
import type { AuthSettings, RedditItem } from "../src/types";

function mockTokenProvider(): TokenProvider {
  const settings: AuthSettings = {
    accessToken: "test-access-token",
    refreshToken: "test-refresh-token",
    tokenExpiry: Date.now() + 3600_000,
    username: "testuser",
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
  };
  return {
    async ensureValidToken() {},
    getSettings() {
      return settings;
    },
  };
}

function makeItem(fullname: string): RedditItem {
  const [kind, id] = fullname.split("_");
  return {
    kind,
    data: {
      id,
      name: fullname,
      author: "someauthor",
      subreddit: "testsub",
      permalink: `/r/testsub/comments/${id}/title/`,
      created_utc: 1700000000,
      score: 10,
      ...(kind === "t3" ? { title: `Title ${id}` } : { body: `Body ${id}` }),
    },
  };
}

describe("importGdprExport", () => {
  let tempDir: string;
  let exportDir: string;
  let storage: SqliteAdapter;
  let api: RedditApiClient;
  /** Fullnames requested per fetchItemsByFullnames call */
  let fetchCalls: string[][];
  /** Fullnames the mock Reddit "knows"; everything else is deleted */
  let available: Set<string> | null;
  const originalFetchItems = RedditApiClient.prototype.fetchItemsByFullnames;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "gdpr-import-"));
    exportDir = join(tempDir, "export");
    storage = new SqliteAdapter(join(tempDir, "test.db"));
    api = new RedditApiClient(mockTokenProvider(), new RequestQueue());
    fetchCalls = [];
    available = null; // null = everything requested exists
    RedditApiClient.prototype.fetchItemsByFullnames = async (fullnames: string[]) => {
      fetchCalls.push([...fullnames]);
      return fullnames.filter((f) => available === null || available.has(f)).map(makeItem);
    };
  });

  afterEach(() => {
    RedditApiClient.prototype.fetchItemsByFullnames = originalFetchItems;
    storage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  function writeCsv(file: string, content: string): void {
    mkdirSync(exportDir, { recursive: true });
    writeFileSync(join(exportDir, file), content);
  }

  test("happy hydration: saved posts and comments land with origin 'saved'", async () => {
    writeCsv(
      "saved_posts.csv",
      "id,permalink\naaa,https://www.reddit.com/r/testsub/comments/aaa/x/\n",
    );
    writeCsv(
      "saved_comments.csv",
      "id,permalink\nbbb,https://www.reddit.com/r/testsub/comments/post1/x/bbb/\n",
    );

    const result = await importGdprExport(storage, api, { dir: exportDir });

    expect(result.wasCancelled).toBe(false);
    expect(result.perOrigin).toEqual([
      { origin: "saved", found: 2, alreadyPresent: 0, hydrated: 2, deletedStubs: 0 },
    ]);
    expect(fetchCalls).toEqual([["t3_aaa", "t1_bbb"]]);

    const post = storage.getPost("aaa");
    expect(post?.content_origin).toBe("saved");
    expect(post?.kind).toBe("t3");
    expect(post?.title).toBe("Title aaa");
    const comment = storage.getPost("bbb");
    expect(comment?.content_origin).toBe("saved");
    expect(comment?.kind).toBe("t1");
    expect(comment?.body).toBe("Body bbb");
  });

  test("locates columns by header name, not position", async () => {
    writeCsv("saved_posts.csv", "permalink,id\nhttps://www.reddit.com/r/x/comments/ccc/y/,ccc\n");

    const result = await importGdprExport(storage, api, { dir: exportDir });

    expect(result.perOrigin[0].hydrated).toBe(1);
    expect(fetchCalls).toEqual([["t3_ccc"]]);
  });

  test("throws a helpful error when the id column is missing", async () => {
    writeCsv("saved_posts.csv", "identifier,permalink\naaa,https://x/\n");

    await expect(importGdprExport(storage, api, { dir: exportDir })).rejects.toThrow(
      'saved_posts.csv: missing "id" column',
    );
  });

  test("skips fullnames already in the posts table without touching them", async () => {
    storage.upsertPosts([makeItem("t3_old")], "upvoted");
    const before = storage.getPost("old");

    writeCsv(
      "saved_posts.csv",
      "id,permalink\nold,https://www.reddit.com/r/testsub/comments/old/x/\nnew1,https://www.reddit.com/r/testsub/comments/new1/x/\n",
    );

    const result = await importGdprExport(storage, api, { dir: exportDir });

    expect(result.perOrigin).toEqual([
      { origin: "saved", found: 2, alreadyPresent: 1, hydrated: 1, deletedStubs: 0 },
    ]);
    // Only the missing fullname was requested
    expect(fetchCalls).toEqual([["t3_new1"]]);
    // The existing row is untouched — origin and timestamps unchanged
    const after = storage.getPost("old");
    expect(after?.content_origin).toBe("upvoted");
    expect(after?.updated_at).toBe(before?.updated_at as number);
  });

  test("skip means skip: an existing row is never replaced by a deleted stub", async () => {
    storage.upsertPosts([makeItem("t3_rich")], "saved");
    available = new Set(); // Reddit claims everything is deleted

    writeCsv(
      "saved_posts.csv",
      "id,permalink\nrich,https://www.reddit.com/r/testsub/comments/rich/x/\ngone,https://www.reddit.com/r/othersub/comments/gone/x/\n",
    );

    const result = await importGdprExport(storage, api, { dir: exportDir });

    expect(result.perOrigin).toEqual([
      { origin: "saved", found: 2, alreadyPresent: 1, hydrated: 0, deletedStubs: 1 },
    ]);
    // Existing row keeps its real content and stays on Reddit
    const rich = storage.getPost("rich");
    expect(rich?.title).toBe("Title rich");
    expect(rich?.author).toBe("someauthor");
    expect(rich?.is_on_reddit).toBe(1);
    // The missing one became an orphaned stub
    const gone = storage.getPost("gone");
    expect(gone?.title).toBe("[deleted]");
    expect(gone?.is_on_reddit).toBe(0);
  });

  test("deleted fullnames become honest orphaned stubs", async () => {
    available = new Set(["t3_alive"]);
    writeCsv(
      "saved_posts.csv",
      "id,permalink\nalive,https://www.reddit.com/r/testsub/comments/alive/x/\ndead,https://www.reddit.com/r/somesub/comments/dead/x/\n",
    );
    writeCsv(
      "saved_comments.csv",
      "id,permalink\ndeadc,https://www.reddit.com/r/somesub/comments/p1/x/deadc/\n",
    );

    const result = await importGdprExport(storage, api, { dir: exportDir });

    expect(result.perOrigin).toEqual([
      { origin: "saved", found: 3, alreadyPresent: 0, hydrated: 1, deletedStubs: 2 },
    ]);

    const deadPost = storage.getPost("dead");
    expect(deadPost?.name).toBe("t3_dead");
    expect(deadPost?.kind).toBe("t3");
    expect(deadPost?.title).toBe("[deleted]");
    expect(deadPost?.body).toBeNull();
    expect(deadPost?.author).toBe("[deleted]");
    expect(deadPost?.subreddit).toBe("somesub");
    expect(deadPost?.permalink).toBe("/r/somesub/comments/dead/x/");
    expect(deadPost?.created_utc).toBe(0);
    expect(deadPost?.score).toBe(0);
    expect(deadPost?.is_on_reddit).toBe(0);
    expect(deadPost?.content_origin).toBe("saved");

    const deadComment = storage.getPost("deadc");
    expect(deadComment?.kind).toBe("t1");
    expect(deadComment?.body).toBe("[deleted]");
    expect(deadComment?.title).toBeNull();
    expect(deadComment?.is_on_reddit).toBe(0);
  });

  test("stub subreddit falls back to [unknown] when the permalink has no /r/", async () => {
    available = new Set();
    writeCsv(
      "saved_posts.csv",
      "id,permalink\nweird,https://www.reddit.com/user/x/comments/weird/\n",
    );

    await importGdprExport(storage, api, { dir: exportDir });

    expect(storage.getPost("weird")?.subreddit).toBe("[unknown]");
  });

  test("post_votes.csv keeps only direction=up rows", async () => {
    writeCsv(
      "post_votes.csv",
      "id,permalink,direction\nup1,https://www.reddit.com/r/a/comments/up1/x/,up\n" +
        "down1,https://www.reddit.com/r/a/comments/down1/x/,down\n" +
        "none1,https://www.reddit.com/r/a/comments/none1/x/,none\n" +
        "up2,https://www.reddit.com/r/a/comments/up2/x/,up\n",
    );

    const result = await importGdprExport(storage, api, { dir: exportDir });

    expect(result.perOrigin).toEqual([
      { origin: "upvoted", found: 2, alreadyPresent: 0, hydrated: 2, deletedStubs: 0 },
    ]);
    expect(fetchCalls).toEqual([["t3_up1", "t3_up2"]]);
    expect(storage.getPost("down1")).toBeNull();
  });

  test("types filter limits which origins run", async () => {
    writeCsv("saved_posts.csv", "id,permalink\nsp1,https://www.reddit.com/r/a/comments/sp1/x/\n");
    writeCsv("comments.csv", "id,permalink\ncm1,https://www.reddit.com/r/a/comments/p/x/cm1/\n");

    const result = await importGdprExport(storage, api, {
      dir: exportDir,
      types: ["commented"],
    });

    expect(result.perOrigin.map((o) => o.origin)).toEqual(["commented"]);
    expect(fetchCalls).toEqual([["t1_cm1"]]);
    expect(storage.getPost("sp1")).toBeNull();
    expect(storage.getPost("cm1")?.content_origin).toBe("commented");
  });

  test("origins without CSV files are omitted from the result", async () => {
    writeCsv("posts.csv", "id,permalink\nmine,https://www.reddit.com/r/a/comments/mine/x/\n");

    const result = await importGdprExport(storage, api, { dir: exportDir });

    expect(result.perOrigin.map((o) => o.origin)).toEqual(["submitted"]);
  });

  test("duplicate ids within an origin are deduped", async () => {
    writeCsv(
      "saved_posts.csv",
      "id,permalink\ndup,https://www.reddit.com/r/a/comments/dup/x/\ndup,https://www.reddit.com/r/a/comments/dup/x/\n",
    );

    const result = await importGdprExport(storage, api, { dir: exportDir });

    expect(result.perOrigin[0].found).toBe(1);
    expect(fetchCalls).toEqual([["t3_dup"]]);
  });

  test("limit caps rows per origin", async () => {
    const rows = Array.from(
      { length: 5 },
      (_, i) => `s${i},https://www.reddit.com/r/a/comments/s${i}/x/`,
    );
    writeCsv("saved_posts.csv", `id,permalink\n${rows.join("\n")}\n`);

    const result = await importGdprExport(storage, api, { dir: exportDir, limit: 2 });

    expect(result.perOrigin[0].found).toBe(2);
    expect(fetchCalls).toEqual([["t3_s0", "t3_s1"]]);
  });

  test("dry run parses and counts with zero network calls and zero writes", async () => {
    storage.upsertPosts([makeItem("t3_have")], "saved");
    writeCsv(
      "saved_posts.csv",
      "id,permalink\nhave,https://www.reddit.com/r/a/comments/have/x/\nwant,https://www.reddit.com/r/a/comments/want/x/\n",
    );

    const result = await importGdprExport(storage, null, { dir: exportDir, dryRun: true });

    expect(result.perOrigin).toEqual([
      { origin: "saved", found: 2, alreadyPresent: 1, hydrated: 0, deletedStubs: 0 },
    ]);
    expect(fetchCalls).toEqual([]);
    expect(storage.getPost("want")).toBeNull();
  });

  test("throws without an API client when not a dry run", async () => {
    writeCsv("saved_posts.csv", "id,permalink\nx,https://www.reddit.com/r/a/comments/x/x/\n");
    await expect(importGdprExport(storage, null, { dir: exportDir })).rejects.toThrow(
      "requires an API client",
    );
  });

  test("more than 100 missing fullnames split into batches of 100", async () => {
    const rows = Array.from(
      { length: 150 },
      (_, i) => `b${i},https://www.reddit.com/r/a/comments/b${i}/x/`,
    );
    writeCsv("saved_posts.csv", `id,permalink\n${rows.join("\n")}\n`);

    const progress: Array<[string, number, number]> = [];
    const result = await importGdprExport(storage, api, {
      dir: exportDir,
      onProgress: (origin, processed, total) => progress.push([origin, processed, total]),
    });

    expect(result.perOrigin[0].hydrated).toBe(150);
    expect(fetchCalls.map((c) => c.length)).toEqual([100, 50]);
    expect(progress).toEqual([
      ["saved", 100, 150],
      ["saved", 150, 150],
    ]);
  });

  test("an aborted signal stops between batches and reports wasCancelled", async () => {
    const rows = Array.from(
      { length: 150 },
      (_, i) => `c${i},https://www.reddit.com/r/a/comments/c${i}/x/`,
    );
    writeCsv("saved_posts.csv", `id,permalink\n${rows.join("\n")}\n`);

    const controller = new AbortController();
    RedditApiClient.prototype.fetchItemsByFullnames = async (fullnames: string[]) => {
      fetchCalls.push([...fullnames]);
      controller.abort(); // abort after the first batch completes
      return fullnames.map(makeItem);
    };

    const result = await importGdprExport(storage, api, {
      dir: exportDir,
      signal: controller.signal,
    });

    expect(result.wasCancelled).toBe(true);
    expect(fetchCalls).toHaveLength(1);
    expect(result.perOrigin[0].hydrated).toBe(100);
  });
});
