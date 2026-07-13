import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { RedditApiClient } from "../src/api/client";
import { SqliteAdapter } from "../src/storage/sqlite-adapter";
import { syncContext } from "../src/sync/context-sync";
import type { RedditItem, RedditItemData } from "../src/types";

function makeTempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "reddit-saved-context-sync-"));
  return join(dir, "test.db");
}

function makeSavedPost(id: string): RedditItem {
  return {
    kind: "t3",
    data: {
      id,
      name: `t3_${id}`,
      title: `Post ${id}`,
      author: "op",
      subreddit: "testsub",
      permalink: `/r/testsub/comments/${id}/post/`,
      created_utc: 1700000000,
      score: 10,
    },
  };
}

function makeSavedComment(id: string): RedditItem {
  return {
    kind: "t1",
    data: {
      id,
      name: `t1_${id}`,
      author: "commenter",
      subreddit: "testsub",
      permalink: `/r/testsub/comments/parentpost/post/${id}/`,
      created_utc: 1700000100,
      score: 4,
      body: `saved comment ${id}`,
      parent_id: "t1_anc2",
      link_id: "t3_parentpost",
    },
  };
}

function makeAncestorData(id: string, parentId: string): RedditItemData {
  return {
    id,
    name: `t1_${id}`,
    author: `anc_${id}`,
    subreddit: "testsub",
    permalink: `/r/testsub/comments/parentpost/post/${id}/`,
    created_utc: 1699999000,
    score: 12,
    body: `ancestor ${id}`,
    parent_id: parentId,
    link_id: "t3_parentpost",
  };
}

function makeThreadComment(id: string, score: number): RedditItemData {
  return {
    id,
    name: `t1_${id}`,
    author: `tc_${id}`,
    subreddit: "testsub",
    permalink: `/r/testsub/comments/p/post/${id}/`,
    created_utc: 1700000050,
    score,
    body: `thread comment ${id}`,
    parent_id: "t3_p",
    link_id: "t3_p",
  };
}

describe("syncContext", () => {
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

  test("saved comment gets its ancestor chain stored as context", async () => {
    storage.upsertPosts([makeSavedComment("target")], "saved");

    const api = {
      fetchCommentWithContext: async (permalink: string) => {
        expect(permalink).toContain("/target/");
        return {
          ...makeSavedComment("target").data,
          parent_comments: [
            makeAncestorData("anc1", "t3_parentpost"),
            makeAncestorData("anc2", "t1_anc1"),
          ],
        };
      },
      fetchCommentThread: async () => {
        throw new Error("should not be called for a comment");
      },
    } as unknown as RedditApiClient;

    const result = await syncContext(storage, api);

    expect(result.processed).toBe(1);
    expect(result.captured).toBe(1);
    expect(result.contextItemsStored).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.remaining).toBe(0);

    expect(storage.getPost("anc1")?.content_origin).toBe("context");
    expect(storage.getPost("anc2")?.content_origin).toBe("context");
    expect(storage.getPost("target")?.context_fetched_at).toBeGreaterThan(0);

    // The stored thread reassembles via getThread
    expect(storage.getThread("t1_target").map((r) => r.id)).toEqual(["anc1", "anc2", "target"]);
  });

  test("saved post gets top comments above the score threshold, capped", async () => {
    storage.upsertPosts([makeSavedPost("p")], "saved");

    const api = {
      fetchCommentWithContext: async () => {
        throw new Error("should not be called for a post");
      },
      fetchCommentThread: async (postId: string, subreddit: string) => {
        expect(postId).toBe("p");
        expect(subreddit).toBe("testsub");
        return {
          post: makeSavedPost("p").data,
          comments: [
            makeThreadComment("good1", 50),
            makeThreadComment("good2", 10),
            makeThreadComment("low", 1), // below default minCommentScore 3
            makeThreadComment("good3", 5),
          ],
          totalComments: 4,
          hasMore: false,
        };
      },
    } as unknown as RedditApiClient;

    const result = await syncContext(storage, api, { topComments: 2 });

    expect(result.captured).toBe(1);
    // good1 and good2 qualify and fit the cap; 'low' filtered, 'good3' capped out
    expect(result.contextItemsStored).toBe(2);
    expect(storage.getPost("good1")?.content_origin).toBe("context");
    expect(storage.getPost("good2")?.content_origin).toBe("context");
    expect(storage.getPost("low")).toBeNull();
    expect(storage.getPost("good3")).toBeNull();
  });

  test("a failing item stays unstamped and is retried next run", async () => {
    storage.upsertPosts([makeSavedPost("ok"), makeSavedPost("bad")], "saved");
    storage.getDb().run("UPDATE posts SET created_utc = 1700000010 WHERE id = 'bad'");

    let calls = 0;
    const api = {
      fetchCommentThread: async (postId: string) => {
        calls++;
        if (postId === "bad") throw new Error("thread unavailable");
        return {
          post: makeSavedPost("ok").data,
          comments: [makeThreadComment("c_ok", 9)],
          totalComments: 1,
          hasMore: false,
        };
      },
    } as unknown as RedditApiClient;

    const errors: string[] = [];
    const result = await syncContext(storage, api, {
      onError: (item, err) => errors.push(`${item.id}: ${(err as Error).message}`),
    });

    expect(calls).toBe(2);
    expect(result.processed).toBe(2);
    expect(result.captured).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.remaining).toBe(1);
    expect(errors).toEqual(["bad: thread unavailable"]);

    expect(storage.getPost("bad")?.context_fetched_at).toBeNull();
    expect(storage.getPost("ok")?.context_fetched_at).toBeGreaterThan(0);
    expect(storage.getContextCandidates(10).map((r) => r.id)).toEqual(["bad"]);
  });

  test("limit bounds the batch and remaining reports the backlog", async () => {
    storage.upsertPosts([makeSavedPost("a"), makeSavedPost("b"), makeSavedPost("c")], "saved");

    const api = {
      fetchCommentThread: async () => ({
        post: makeSavedPost("x").data,
        comments: [],
        totalComments: 0,
        hasMore: false,
      }),
    } as unknown as RedditApiClient;

    const result = await syncContext(storage, api, { limit: 2 });
    expect(result.processed).toBe(2);
    expect(result.captured).toBe(2);
    expect(result.remaining).toBe(1);

    const second = await syncContext(storage, api, { limit: 2 });
    expect(second.processed).toBe(1);
    expect(second.remaining).toBe(0);
  });

  test("abort stops between items and reports wasCancelled", async () => {
    storage.upsertPosts([makeSavedPost("a"), makeSavedPost("b")], "saved");

    const controller = new AbortController();
    const api = {
      fetchCommentThread: async () => {
        controller.abort();
        return { post: makeSavedPost("a").data, comments: [], totalComments: 0, hasMore: false };
      },
    } as unknown as RedditApiClient;

    const result = await syncContext(storage, api, { signal: controller.signal });
    expect(result.wasCancelled).toBe(true);
    expect(result.processed).toBe(1);
    expect(result.remaining).toBe(1);
  });

  test("malformed comment data (missing name/permalink) is skipped, not stored", async () => {
    storage.upsertPosts([makeSavedPost("p")], "saved");

    const api = {
      fetchCommentThread: async () => ({
        post: makeSavedPost("p").data,
        comments: [
          makeThreadComment("whole", 8),
          { id: "broken", score: 99, body: "no name or permalink" } as RedditItemData,
        ],
        totalComments: 2,
        hasMore: false,
      }),
    } as unknown as RedditApiClient;

    const result = await syncContext(storage, api);
    expect(result.captured).toBe(1);
    expect(result.contextItemsStored).toBe(1);
    expect(storage.getPost("whole")).not.toBeNull();
    expect(storage.getPost("broken")).toBeNull();
  });
});
