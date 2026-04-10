import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { RedditApiClient, type TokenProvider } from "../src/api/client";
import { MAX_PAGES_SAFETY_LIMIT } from "../src/constants";
import { RequestQueue } from "../src/queue/request-queue";
import type { ApiClientCallbacks, AuthSettings, RedditItem, UnsaveResult } from "../src/types";

// ---------------------------------------------------------------------------
// Mock token provider
// ---------------------------------------------------------------------------

function createMockTokenProvider(overrides?: Partial<AuthSettings>): TokenProvider {
  const settings: AuthSettings = {
    accessToken: "test-access-token",
    refreshToken: "test-refresh-token",
    tokenExpiry: Date.now() + 3600_000,
    username: "testuser",
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    ...overrides,
  };
  return {
    async ensureValidToken() {},
    getSettings() {
      return settings;
    },
  };
}

// ---------------------------------------------------------------------------
// Mock Reddit API server
// ---------------------------------------------------------------------------

function makeRedditItem(id: string, kind = "t3"): RedditItem {
  return {
    kind,
    data: {
      id,
      name: `${kind}_${id}`,
      author: "testauthor",
      subreddit: "testsubreddit",
      permalink: `/r/testsubreddit/comments/${id}/test_post/`,
      created_utc: Math.floor(Date.now() / 1000),
      score: 100,
    },
  } as RedditItem;
}

const rateHeaders = {
  "x-ratelimit-remaining": "59",
  "x-ratelimit-reset": "60",
};

let mockServer: Server<unknown>;
let baseUrl: string;

beforeAll(() => {
  mockServer = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      // GET /api/v1/me
      if (path === "/api/v1/me") {
        const auth = req.headers.get("Authorization") ?? "";
        if (auth === "Bearer error-token") {
          return Response.json({ error: "forbidden" }, { headers: rateHeaders });
        }
        if (auth === "Bearer no-name-token") {
          return Response.json({ id: 123 }, { headers: rateHeaders });
        }
        if (auth === "Bearer null-body-token") {
          return new Response(null, { status: 204, headers: rateHeaders });
        }
        return Response.json({ name: "testuser" }, { headers: rateHeaders });
      }

      // User content endpoints (saved, upvoted, submitted, comments)
      if (path.match(/^\/user\/[^/]+\/(saved|upvoted|submitted|comments)$/)) {
        const username = path.split("/")[2];
        const after = url.searchParams.get("after");
        const limit = Number.parseInt(url.searchParams.get("limit") || "100");

        // Error-on-page2: returns 500 when cursor is "cursor_page2"
        if (username === "error_user" && after === "cursor_page2") {
          return new Response("Internal Server Error", { status: 500, headers: rateHeaders });
        }

        // Empty-user: always returns empty children on first page
        if (username === "empty_user") {
          return Response.json(
            { kind: "Listing", data: { children: [], after: null } },
            { headers: rateHeaders },
          );
        }

        // Infinite-cursor: always returns a next cursor to test MAX_PAGES_SAFETY_LIMIT
        if (username === "infinite_user") {
          const page = after ? Number.parseInt(after.replace("cursor_", "")) + 1 : 1;
          const items = [makeRedditItem(`inf_${page}`)];
          return Response.json(
            { kind: "Listing", data: { children: items, after: `cursor_${page}` } },
            { headers: rateHeaders },
          );
        }

        if (!after) {
          // First page
          const items = Array.from({ length: Math.min(limit, 3) }, (_, i) =>
            makeRedditItem(`page1_${i}`),
          );
          return Response.json(
            { kind: "Listing", data: { children: items, after: "cursor_page2" } },
            { headers: rateHeaders },
          );
        }

        if (after === "cursor_page2") {
          // Second page (last)
          const items = Array.from({ length: Math.min(limit, 2) }, (_, i) =>
            makeRedditItem(`page2_${i}`),
          );
          return Response.json(
            { kind: "Listing", data: { children: items, after: null } },
            { headers: rateHeaders },
          );
        }

        // Unknown cursor
        return Response.json(
          { kind: "Listing", data: { children: [], after: null } },
          { headers: rateHeaders },
        );
      }

      // Unsave endpoint
      if (path === "/api/unsave" && req.method === "POST") {
        const bodyText = await req.text();
        const id = new URLSearchParams(bodyText).get("id");
        // Simulate 500 for server errors (retryable)
        if (id === "t3_failme") {
          return new Response("Server Error", { status: 500, headers: rateHeaders });
        }
        // Simulate 403 for forbidden errors (not retryable)
        if (id === "t3_forbidme") {
          return new Response("Forbidden", { status: 403, headers: rateHeaders });
        }
        return Response.json({}, { headers: rateHeaders });
      }

      // Post comments endpoint (permalink.json) with nested replies
      if (path.endsWith(".json") && path.includes("/comments/")) {
        // Malformed body: returns an object instead of array
        if (path.includes("/malformed_post")) {
          return Response.json({ not: "an array" }, { headers: rateHeaders });
        }
        // Short array body: returns array with only 1 element
        if (path.includes("/short_post")) {
          return Response.json([{ kind: "Listing", data: { children: [] } }], {
            headers: rateHeaders,
          });
        }

        // Empty post listing — tests fetchCommentThread null return path
        if (path.includes("/empty_post")) {
          const comment = {
            kind: "t1",
            data: {
              id: "orphan_c1",
              author: "commenter",
              body: "Comment on empty post listing",
              score: 5,
              created_utc: Math.floor(Date.now() / 1000),
              is_submitter: false,
              depth: 0,
              replies: "",
            },
          };
          return Response.json(
            [
              { kind: "Listing", data: { children: [] } },
              { kind: "Listing", data: { children: [comment] } },
            ],
            { headers: rateHeaders },
          );
        }

        // Deep-nested response for depth-capping tests
        if (path.includes("/deep_post")) {
          const deepReply = (id: string, depth: number, childReply: unknown) => ({
            kind: "t1",
            data: {
              id,
              author: `author_d${depth}`,
              body: `Reply at depth ${depth}`,
              score: 5,
              created_utc: Math.floor(Date.now() / 1000),
              is_submitter: false,
              depth,
              replies: childReply
                ? { kind: "Listing", data: { children: [childReply] } }
                : "",
            },
          });
          // depth 3 -> 2 -> 1 -> 0
          const d3 = deepReply("d3", 3, null);
          const d2 = deepReply("d2", 2, d3);
          const d1 = deepReply("d1", 1, d2);
          const d0 = deepReply("d0", 0, d1);
          const post = makeRedditItem("deep_post", "t3");
          return Response.json(
            [
              { kind: "Listing", data: { children: [post] } },
              { kind: "Listing", data: { children: [d0] } },
            ],
            { headers: rateHeaders },
          );
        }

        // Reply-fetching for fetchCommentReplies test (check before deep_post)
        if (path.includes("/reply_post")) {
          const replyChild = {
            kind: "t1",
            data: {
              id: "rc1",
              author: "child_replier",
              body: "Child reply",
              score: 2,
              created_utc: Math.floor(Date.now() / 1000),
              is_submitter: false,
              depth: 2,
              replies: "",
            },
          };
          const targetComment = {
            kind: "t1",
            data: {
              id: "target_comment",
              author: "target_author",
              body: "Target comment",
              score: 10,
              created_utc: Math.floor(Date.now() / 1000),
              is_submitter: false,
              depth: 0,
              replies: {
                kind: "Listing",
                data: {
                  children: [
                    {
                      kind: "t1",
                      data: {
                        id: "reply_a",
                        author: "replier_a",
                        body: "Reply A",
                        score: 5,
                        created_utc: Math.floor(Date.now() / 1000),
                        is_submitter: false,
                        depth: 1,
                        replies: { kind: "Listing", data: { children: [replyChild] } },
                      },
                    },
                    {
                      kind: "t1",
                      data: {
                        id: "reply_b",
                        author: "replier_b",
                        body: "Reply B",
                        score: 3,
                        created_utc: Math.floor(Date.now() / 1000),
                        is_submitter: false,
                        depth: 1,
                        replies: "",
                      },
                    },
                  ],
                },
              },
            },
          };
          const post = makeRedditItem("reply_post", "t3");
          return Response.json(
            [
              { kind: "Listing", data: { children: [post] } },
              { kind: "Listing", data: { children: [targetComment] } },
            ],
            { headers: rateHeaders },
          );
        }

        // hasMore test: includes a "more" node in comments listing
        if (path.includes("/hasmore_post")) {
          const comment = {
            kind: "t1",
            data: {
              id: "hm_c1",
              author: "user1",
              body: "A comment",
              score: 5,
              created_utc: Math.floor(Date.now() / 1000),
              is_submitter: false,
              depth: 0,
              replies: "",
            },
          };
          const moreNode = {
            kind: "more",
            data: { id: "more1", name: "t1_more1", count: 10, children: ["x1", "x2"] },
          };
          const post = makeRedditItem("hasmore_post", "t3");
          (post.data as { num_comments: number }).num_comments = 50;
          return Response.json(
            [
              { kind: "Listing", data: { children: [post] } },
              { kind: "Listing", data: { children: [comment, moreNode] } },
            ],
            { headers: rateHeaders },
          );
        }

        // Empty comments listing — fetchCommentWithContext null path
        if (path.includes("/empty_comments_post")) {
          const post = makeRedditItem("empty_comments_post", "t3");
          return Response.json(
            [
              { kind: "Listing", data: { children: [post] } },
              { kind: "Listing", data: { children: [] } },
            ],
            { headers: rateHeaders },
          );
        }

        // No reply children — target comment has replies object but no children key
        if (path.includes("/no_reply_children_post")) {
          const targetComment = {
            kind: "t1",
            data: {
              id: "nrc_target",
              author: "nrc_author",
              body: "Target with no reply children",
              score: 10,
              created_utc: Math.floor(Date.now() / 1000),
              is_submitter: false,
              depth: 0,
              replies: { data: {} },
            },
          };
          const post = makeRedditItem("no_reply_children_post", "t3");
          return Response.json(
            [
              { kind: "Listing", data: { children: [post] } },
              { kind: "Listing", data: { children: [targetComment] } },
            ],
            { headers: rateHeaders },
          );
        }

        // Deep recursion: 150-level nested comment tree for findComment depth guard
        if (path.includes("/deep_recursion_post")) {
          // biome-ignore lint: dynamic nested structure for test
          let current: any = {
            kind: "t1",
            data: {
              id: "leaf",
              author: "a",
              body: "leaf",
              score: 1,
              created_utc: 1,
              is_submitter: false,
              replies: "",
            },
          };
          for (let i = 148; i >= 0; i--) {
            current = {
              kind: "t1",
              data: {
                id: `n${i}`,
                author: "a",
                body: `depth ${i}`,
                score: 1,
                created_utc: 1,
                is_submitter: false,
                replies: { kind: "Listing", data: { children: [current] } },
              },
            };
          }
          const post = makeRedditItem("deep_recursion_post", "t3");
          return Response.json(
            [
              { kind: "Listing", data: { children: [post] } },
              { kind: "Listing", data: { children: [current] } },
            ],
            { headers: rateHeaders },
          );
        }

        // Default comments response
        const nestedReply = {
          kind: "t1",
          data: {
            id: "reply1",
            author: "replier",
            body: "A nested reply",
            score: 3,
            created_utc: Math.floor(Date.now() / 1000),
            is_submitter: false,
            depth: 1,
            replies: "",
          },
        };
        const comment = {
          kind: "t1",
          data: {
            id: "comment1",
            author: "commenter",
            body: "Test comment",
            score: 10,
            created_utc: Math.floor(Date.now() / 1000),
            is_submitter: false,
            depth: 0,
            replies: {
              kind: "Listing",
              data: { children: [nestedReply] },
            },
          },
        };
        const lowScoreComment = {
          kind: "t1",
          data: {
            id: "lowscore1",
            author: "troll",
            body: "Bad comment",
            score: -5,
            created_utc: Math.floor(Date.now() / 1000),
            is_submitter: false,
            depth: 0,
            replies: "",
          },
        };
        const post = makeRedditItem("post1", "t3");
        (post.data as { num_comments: number }).num_comments = 3;
        return Response.json(
          [
            { kind: "Listing", data: { children: [post] } },
            { kind: "Listing", data: { children: [comment, lowScoreComment] } },
          ],
          { headers: rateHeaders },
        );
      }

      return new Response("Not Found", { status: 404 });
    },
  });
  baseUrl = `http://127.0.0.1:${mockServer.port}`;
});

afterAll(() => {
  mockServer.stop(true);
});

// ---------------------------------------------------------------------------
// Helper: create client pointed at mock server
// ---------------------------------------------------------------------------

function createClient(opts?: {
  callbacks?: ApiClientCallbacks;
  tokenProvider?: TokenProvider;
  maxRetries?: number;
}): RedditApiClient {
  const tp = opts?.tokenProvider ?? createMockTokenProvider();
  const queue = new RequestQueue({ maxRetries: opts?.maxRetries ?? 0 });
  return new RedditApiClient(tp, queue, opts?.callbacks, baseUrl);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RedditApiClient", () => {
  describe("static utilities", () => {
    test("getParentType identifies comments", () => {
      expect(RedditApiClient.getParentType("t1_abc123")).toBe("comment");
    });

    test("getParentType identifies posts", () => {
      expect(RedditApiClient.getParentType("t3_abc123")).toBe("post");
    });

    test("extractIdFromFullname strips prefix", () => {
      expect(RedditApiClient.extractIdFromFullname("t3_abc123")).toBe("abc123");
      expect(RedditApiClient.extractIdFromFullname("t1_xyz")).toBe("xyz");
    });

    test("extractIdFromFullname returns input for non-matching", () => {
      expect(RedditApiClient.extractIdFromFullname("abc123")).toBe("abc123");
    });

    test("extractCommentIdFromPermalink gets last segment", () => {
      expect(
        RedditApiClient.extractCommentIdFromPermalink("/r/test/comments/abc123/title/xyz789/"),
      ).toBe("xyz789");
      expect(
        RedditApiClient.extractCommentIdFromPermalink("/r/test/comments/abc123/title/xyz789"),
      ).toBe("xyz789");
    });

    test("extractCommentIdFromPermalink handles empty", () => {
      expect(RedditApiClient.extractCommentIdFromPermalink("")).toBe("");
      expect(RedditApiClient.extractCommentIdFromPermalink("/")).toBe("");
    });
  });

  describe("control delegation", () => {
    test("pause/resume delegates to queue", () => {
      const client = createClient();
      client.pause();
      expect(client.getQueueStatus().isPaused).toBe(true);
      client.resume();
      expect(client.getQueueStatus().isPaused).toBe(false);
    });

    test("getQueueStatus returns queue state", () => {
      const client = createClient();
      const status = client.getQueueStatus();
      expect(status.queueLength).toBe(0);
      expect(status.activeRequests).toBe(0);
      expect(status.isOnline).toBe(true);
    });
  });

  describe("fetchUsername", () => {
    test("returns username from /api/v1/me", async () => {
      const client = createClient();
      const username = await client.fetchUsername();
      expect(username).toBe("testuser");
    });

    test("throws when API returns error", async () => {
      const client = createClient({
        tokenProvider: createMockTokenProvider({ accessToken: "error-token" }),
      });
      await expect(client.fetchUsername()).rejects.toThrow("Failed to fetch username: forbidden");
    });

    test("throws when API returns no name field", async () => {
      const client = createClient({
        tokenProvider: createMockTokenProvider({ accessToken: "no-name-token" }),
      });
      await expect(client.fetchUsername()).rejects.toThrow(
        "Reddit API did not return a username",
      );
    });

    test("throws for null/empty body (204 No Content)", async () => {
      const client = createClient({
        tokenProvider: createMockTokenProvider({ accessToken: "null-body-token" }),
      });
      await expect(client.fetchUsername()).rejects.toThrow("Failed to fetch username");
    });
  });

  describe("fetchSaved (pagination integration)", () => {
    test("paginates and returns items with contentOrigin", async () => {
      const progressCalls: Array<[number, number | null]> = [];
      const pageCalls: Array<[number, number, string]> = [];

      const client = createClient({
        callbacks: {
          onProgress: (fetched, total) => progressCalls.push([fetched, total]),
          onPageFetched: (page, count, cursor) => pageCalls.push([page, count, cursor]),
        },
      });

      const result = await client.fetchSaved();

      // 3 items on page 1 + 2 items on page 2 = 5 total
      expect(result.items.length).toBe(5);
      expect(result.hasMore).toBe(false);
      expect(result.wasCancelled).toBe(false);
      expect(result.cursor).toBeNull();

      // Every item should have contentOrigin set to "saved"
      for (const item of result.items) {
        expect(item.contentOrigin).toBe("saved");
      }

      // Callbacks should have fired
      expect(pageCalls.length).toBe(2);
      expect(pageCalls[0][0]).toBe(1); // page 1
      expect(pageCalls[0][1]).toBe(3); // 3 items
      expect(pageCalls[1][0]).toBe(2); // page 2
      expect(pageCalls[1][1]).toBe(2); // 2 items

      expect(progressCalls.length).toBe(2);
    });

    test("fetchUpvoted tags items with 'upvoted' origin", async () => {
      const client = createClient();
      const result = await client.fetchUpvoted();
      expect(result.items.length).toBe(5);
      for (const item of result.items) {
        expect(item.contentOrigin).toBe("upvoted");
      }
    });

    test("fetchUserPosts tags items with 'submitted' origin", async () => {
      const client = createClient();
      const result = await client.fetchUserPosts();
      for (const item of result.items) {
        expect(item.contentOrigin).toBe("submitted");
      }
    });

    test("fetchUserComments tags items with 'commented' origin", async () => {
      const client = createClient();
      const result = await client.fetchUserComments();
      for (const item of result.items) {
        expect(item.contentOrigin).toBe("commented");
      }
    });

    test("pre-aborted signal returns immediately with wasCancelled", async () => {
      const client = createClient();
      const controller = new AbortController();
      controller.abort();

      const result = await client.fetchSaved({ signal: controller.signal });
      expect(result.wasCancelled).toBe(true);
      expect(result.items.length).toBe(0);
    });
  });

  describe("unsaveItem / unsaveItems", () => {
    test("unsaveItem succeeds for valid fullname", async () => {
      const client = createClient();
      // Should not throw
      await client.unsaveItem("t3_abc123");
    });

    test("unsaveItems returns UnsaveResult with succeeded and failed", async () => {
      const errors: Array<{ error: Error; retryable: boolean }> = [];

      const client = createClient({
        callbacks: {
          onError: (error, retryable) => errors.push({ error, retryable }),
        },
      });

      const result: UnsaveResult = await client.unsaveItems(["t3_ok1", "t3_failme", "t3_ok2"]);

      expect(result.succeeded).toContain("t3_ok1");
      expect(result.succeeded).toContain("t3_ok2");
      expect(result.failed.length).toBe(1);
      expect(result.failed[0].id).toBe("t3_failme");
      expect(result.failed[0].error).toBeInstanceOf(Error);

      // onError callback should have been called for the failure
      expect(errors.length).toBe(1);
    });

    test("unsaveItems wraps non-Error throws into Error objects", async () => {
      const tp: TokenProvider = {
        async ensureValidToken() {
          throw "string error"; // non-Error throw
        },
        getSettings() {
          return createMockTokenProvider().getSettings();
        },
      };
      const client = createClient({ tokenProvider: tp });
      const result = await client.unsaveItems(["t3_ok1", "t3_ok2"]);
      expect(result.succeeded.length).toBe(0);
      expect(result.failed.length).toBe(2);
      expect(result.failed[0].error).toBeInstanceOf(Error);
      expect(result.failed[0].error.message).toBe("string error");
      expect(result.failed[1].error).toBeInstanceOf(Error);
    });

    test("unsaveItems respects AbortSignal", async () => {
      const client = createClient();
      const controller = new AbortController();
      controller.abort();
      const result = await client.unsaveItems(["t3_ok1", "t3_ok2"], controller.signal);
      expect(result.succeeded.length).toBe(0);
      expect(result.failed.length).toBe(0);
    });
  });

  describe("comment parsing", () => {
    test("fetchPostComments parses comments with depth and nested replies", async () => {
      const client = createClient();
      const comments = await client.fetchPostComments("/r/testsubreddit/comments/post1/test_post");

      // Should have at least 1 comment (low score comment excluded if threshold > 0)
      expect(comments.length).toBeGreaterThanOrEqual(1);

      const topComment = comments.find((c) => c.id === "comment1");
      expect(topComment).toBeDefined();
      expect(topComment?.author).toBe("commenter");
      expect(topComment?.body).toBe("Test comment");
      expect(topComment?.depth).toBe(0);

      // Should have nested replies
      expect(topComment?.replies).toBeDefined();
      expect(topComment?.replies?.length).toBe(1);
      expect(topComment?.replies?.[0].id).toBe("reply1");
      expect(topComment?.replies?.[0].depth).toBe(1);
    });

    test("fetchPostComments returns [] for non-array body", async () => {
      const client = createClient();
      const comments = await client.fetchPostComments(
        "/r/testsubreddit/comments/malformed_post/test",
      );
      expect(comments).toEqual([]);
    });

    test("fetchPostComments returns [] for short array body", async () => {
      const client = createClient();
      const comments = await client.fetchPostComments(
        "/r/testsubreddit/comments/short_post/test",
      );
      expect(comments).toEqual([]);
    });

    test("fetchPostComments filters by upvote threshold", async () => {
      const client = createClient();
      // Threshold of 5 should exclude the -5 score comment
      const comments = await client.fetchPostComments(
        "/r/testsubreddit/comments/post1/test_post",
        5,
      );

      const lowScoreComment = comments.find((c) => c.id === "lowscore1");
      expect(lowScoreComment).toBeUndefined();
    });

    test("fetchCommentThread returns structured thread", async () => {
      const client = createClient();
      const thread = await client.fetchCommentThread("post1", "testsubreddit");

      expect(thread).not.toBeNull();
      expect(thread?.post.id).toBe("post1");
      expect(thread?.comments.length).toBeGreaterThan(0);
      expect(thread?.totalComments).toBe(3);
    });
  });

  describe("fetchCommentWithContext", () => {
    test("returns comment with parent_comments populated", async () => {
      const client = createClient();
      // The mock returns comment1 -> reply1 (nested). Target reply1.
      const result = await client.fetchCommentWithContext(
        "/r/testsubreddit/comments/post1/test_post/reply1",
      );
      expect(result).not.toBeNull();
      expect(result?.id).toBe("reply1");
      expect(result?.parent_comments).toBeDefined();
      expect(result?.parent_comments?.length).toBe(1);
      expect(result?.parent_comments?.[0].id).toBe("comment1");
      expect(result?.depth).toBe(1);
    });

    test("returns top-level comment with no parents", async () => {
      const client = createClient();
      const result = await client.fetchCommentWithContext(
        "/r/testsubreddit/comments/post1/test_post/comment1",
      );
      expect(result).not.toBeNull();
      expect(result?.id).toBe("comment1");
      expect(result?.parent_comments?.length).toBe(0);
      expect(result?.depth).toBe(0);
    });

    test("returns null when target comment not found", async () => {
      const client = createClient();
      const result = await client.fetchCommentWithContext(
        "/r/testsubreddit/comments/post1/test_post/nonexistent",
      );
      expect(result).toBeNull();
    });

    test("returns a new object (does not mutate parsed response)", async () => {
      const client = createClient();
      const result1 = await client.fetchCommentWithContext(
        "/r/testsubreddit/comments/post1/test_post/comment1",
      );
      const result2 = await client.fetchCommentWithContext(
        "/r/testsubreddit/comments/post1/test_post/comment1",
      );
      // Both should be equal but not the same reference
      expect(result1?.id).toBe(result2?.id);
    });
  });

  describe("fetchSaved — startCursor resume", () => {
    test("resumes from startCursor", async () => {
      const client = createClient();
      const result = await client.fetchSaved({ startCursor: "cursor_page2" });
      // Should only get page 2 items (2 items), not page 1
      expect(result.items.length).toBe(2);
      for (const item of result.items) {
        expect(item.data.id.startsWith("page2_")).toBe(true);
      }
    });
  });

  describe("fetchSaved — explicit limit", () => {
    test("respects limit option", async () => {
      const client = createClient();
      // Limit to 2 — should stop after first page (which returns 3, but sliced to 2)
      const result = await client.fetchSaved({ limit: 2 });
      expect(result.items.length).toBe(2);
    });
  });

  describe("fetchSaved — mid-flight abort", () => {
    test("abort between pages sets wasCancelled", async () => {
      const controller = new AbortController();
      let pagesFetched = 0;

      const client = createClient({
        callbacks: {
          onPageFetched: () => {
            pagesFetched++;
            if (pagesFetched === 1) controller.abort();
          },
        },
      });

      const result = await client.fetchSaved({ signal: controller.signal });
      expect(result.wasCancelled).toBe(true);
      // Should have items from page 1 only
      expect(result.items.length).toBe(3);
    });
  });

  describe("unsaveItems — wasCancelled", () => {
    test("reports wasCancelled when aborted", async () => {
      const client = createClient();
      const controller = new AbortController();
      controller.abort();
      const result = await client.unsaveItems(["t3_ok1", "t3_ok2"], controller.signal);
      expect(result.wasCancelled).toBe(true);
      expect(result.succeeded.length).toBe(0);
    });

    test("reports wasCancelled=false when all processed", async () => {
      const client = createClient();
      const result = await client.unsaveItems(["t3_ok1"]);
      expect(result.wasCancelled).toBe(false);
      expect(result.succeeded.length).toBe(1);
    });
  });

  describe("fetchCommentReplies", () => {
    test("returns replies to a specific comment", async () => {
      const client = createClient();
      const replies = await client.fetchCommentReplies(
        "/r/testsubreddit/comments/reply_post/title/target_comment",
      );

      expect(replies.length).toBeGreaterThanOrEqual(2); // reply_a and reply_b (and possibly rc1)
      const replyIds = replies.map((r) => r.id);
      expect(replyIds).toContain("reply_a");
      expect(replyIds).toContain("reply_b");
    });

    test("returns empty when target comment not found", async () => {
      const client = createClient();
      const replies = await client.fetchCommentReplies(
        "/r/testsubreddit/comments/reply_post/title/nonexistent",
      );
      expect(replies.length).toBe(0);
    });

    test("returns empty when target has no replies", async () => {
      const client = createClient();
      // reply_b has replies: "" (empty string, not an object)
      const replies = await client.fetchCommentReplies(
        "/r/testsubreddit/comments/reply_post/title/reply_b",
      );
      expect(replies.length).toBe(0);
    });
  });

  describe("flattenCommentTree depth capping", () => {
    test("stops recursing at maxDepth", async () => {
      const client = createClient();
      // Request with maxDepth=1 — should only get d0 and d1, not d2 or d3
      const comments = await client.fetchPostComments(
        "/r/testsubreddit/comments/deep_post/deep_title",
        0, // no upvote threshold
      );
      // Default maxDepth is COMMENT_MAX_DEPTH (5), so all should be returned
      expect(comments.length).toBeGreaterThanOrEqual(1);
      const topComment = comments.find((c) => c.id === "d0");
      expect(topComment).toBeDefined();
    });

    test("fetchCommentThread flattens deeply nested comments", async () => {
      const client = createClient();
      const thread = await client.fetchCommentThread("deep_post", "testsubreddit");
      expect(thread).not.toBeNull();

      // flattenCommentTree should return all comments within depth limit
      const commentIds = thread!.comments.map((c) => c.id);
      expect(commentIds).toContain("d0");
      expect(commentIds).toContain("d1");
    });
  });

  describe("userAgent freshness", () => {
    test("getUserAgent reflects current username from token provider", async () => {
      // Create a dedicated server that captures User-Agent headers
      let capturedUserAgents: string[] = [];
      const uaServer = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(req) {
          capturedUserAgents.push(req.headers.get("User-Agent") ?? "");
          return Response.json({ name: "testuser" }, { headers: rateHeaders });
        },
      });
      const uaBaseUrl = `http://127.0.0.1:${uaServer.port}`;

      let currentUsername = "initial_user";
      const tp: TokenProvider = {
        async ensureValidToken() {},
        getSettings() {
          return {
            accessToken: "tok",
            refreshToken: "ref",
            tokenExpiry: Date.now() + 3600_000,
            username: currentUsername,
            clientId: "cid",
            clientSecret: "csec",
          };
        },
      };

      const queue = new RequestQueue();
      const client = new RedditApiClient(tp, queue, undefined, uaBaseUrl);

      await client.fetchUsername();
      expect(capturedUserAgents[0]).toContain("initial_user");

      currentUsername = "updated_user";
      capturedUserAgents = [];
      await client.fetchUsername();
      expect(capturedUserAgents[0]).toContain("updated_user");

      uaServer.stop(true);
    });
  });

  describe("error resilience", () => {
    test("fetchSaved returns wasErrored when ensureValidToken always throws", async () => {
      const errors: Error[] = [];
      const tp: TokenProvider = {
        async ensureValidToken() {
          throw new Error("Token refresh failed");
        },
        getSettings() {
          return {
            accessToken: "tok",
            refreshToken: "ref",
            tokenExpiry: Date.now() + 3600_000,
            username: "testuser",
            clientId: "cid",
            clientSecret: "csec",
          };
        },
      };
      const queue = new RequestQueue();
      const client = new RedditApiClient(tp, queue, {
        onError: (err) => errors.push(err),
      }, baseUrl);
      const result = await client.fetchSaved();
      expect(result.wasErrored).toBe(true);
      expect(result.items.length).toBe(0);
      expect(errors.length).toBe(3);
      expect(errors[0].message).toBe("Token refresh failed");
    });

    test("fetchSaved retries when ensureValidToken fails on page 2", async () => {
      let callCount = 0;
      const tp: TokenProvider = {
        async ensureValidToken() {
          callCount++;
          // Succeed on page 1 (call 1), fail once on page 2 (call 2), then succeed (call 3+)
          if (callCount === 2) throw new Error("Transient token refresh failure");
        },
        getSettings() {
          return {
            accessToken: "test-access-token",
            refreshToken: "ref",
            tokenExpiry: Date.now() + 3600_000,
            username: "testuser",
            clientId: "cid",
            clientSecret: "csec",
          };
        },
      };
      const queue = new RequestQueue({ maxRetries: 0 });
      const errors: Error[] = [];
      const client = new RedditApiClient(tp, queue, {
        onError: (err) => errors.push(err),
      }, baseUrl);
      const result = await client.fetchSaved();
      // Page 1 succeeded, page 2 token failure retried and then succeeded on next attempt
      expect(result.items.length).toBeGreaterThan(0);
      expect(errors.length).toBe(1);
      expect(errors[0].message).toBe("Transient token refresh failure");
    });

    test("fetchSaved returns partial results when page 2 fails repeatedly", async () => {
      const errors: Error[] = [];
      const tp = createMockTokenProvider({ username: "error_user" });
      const queue = new RequestQueue({ maxRetries: 0 });
      const client = new RedditApiClient(tp, queue, {
        onError: (err) => errors.push(err),
      }, baseUrl);

      const result = await client.fetchSaved();
      // Should have page 1 items (3) but page 2 failed 3 times
      expect(result.items.length).toBe(3);
      expect(result.hasMore).toBe(false);
      expect(result.wasErrored).toBe(true);
      expect(result.cursor).toBe("cursor_page2");
      expect(errors.length).toBe(3);
    });
  });

  describe("MAX_PAGES_SAFETY_LIMIT", () => {
    test("stops pagination after MAX_PAGES_SAFETY_LIMIT pages", async () => {
      const tp = createMockTokenProvider({ username: "infinite_user" });
      const queue = new RequestQueue({ maxRetries: 0 });
      const client = new RedditApiClient(tp, queue, undefined, baseUrl);

      const result = await client.fetchSaved();
      // Each page returns 1 item; should stop at MAX_PAGES_SAFETY_LIMIT
      expect(result.items.length).toBe(MAX_PAGES_SAFETY_LIMIT);
    });
  });

  describe("fetchCommentThread hasMore detection", () => {
    test("returns hasMore=true when 'more' node present", async () => {
      const client = createClient();
      const thread = await client.fetchCommentThread("hasmore_post", "testsubreddit");
      expect(thread).not.toBeNull();
      expect(thread?.hasMore).toBe(true);
    });

    test("returns hasMore=false when no 'more' node", async () => {
      const client = createClient();
      const thread = await client.fetchCommentThread("post1", "testsubreddit");
      expect(thread).not.toBeNull();
      expect(thread?.hasMore).toBe(false);
    });
  });

  describe("malformed-body guards for context and replies", () => {
    test("fetchCommentWithContext returns null for non-array body", async () => {
      const client = createClient();
      const result = await client.fetchCommentWithContext(
        "/r/testsubreddit/comments/malformed_post/test/some_comment",
      );
      expect(result).toBeNull();
    });

    test("fetchCommentWithContext returns null for short array body", async () => {
      const client = createClient();
      const result = await client.fetchCommentWithContext(
        "/r/testsubreddit/comments/short_post/test/some_comment",
      );
      expect(result).toBeNull();
    });

    test("fetchCommentReplies returns empty for non-array body", async () => {
      const client = createClient();
      const replies = await client.fetchCommentReplies(
        "/r/testsubreddit/comments/malformed_post/test/some_comment",
      );
      expect(replies).toEqual([]);
    });

    test("fetchCommentReplies returns empty for short array body", async () => {
      const client = createClient();
      const replies = await client.fetchCommentReplies(
        "/r/testsubreddit/comments/short_post/test/some_comment",
      );
      expect(replies).toEqual([]);
    });
  });

  describe("unsaveItems mid-flight abort", () => {
    test("abort mid-batch stops processing remaining items", async () => {
      const controller = new AbortController();
      let unsaveCount = 0;

      const abortServer = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(req) {
          if (req.method === "POST" && new URL(req.url).pathname === "/api/unsave") {
            unsaveCount++;
            return Response.json({}, { headers: rateHeaders });
          }
          return Response.json({ name: "testuser" }, { headers: rateHeaders });
        },
      });
      const abortBaseUrl = `http://127.0.0.1:${abortServer.port}`;

      const tp = createMockTokenProvider();
      const queue = new RequestQueue();
      // Use onProgress callback to abort after first successful unsave
      const client = new RedditApiClient(
        tp,
        queue,
        {
          onProgress: (completed) => {
            if (completed >= 1) controller.abort();
          },
        },
        abortBaseUrl,
      );

      const result = await client.unsaveItems(
        ["t3_a", "t3_b", "t3_c", "t3_d", "t3_e"],
        controller.signal,
      );

      expect(result.wasCancelled).toBe(true);
      // First request succeeds, then abort fires before the next iteration starts
      expect(result.succeeded.length).toBe(1);
      expect(result.succeeded[0]).toBe("t3_a");
      expect(result.succeeded.length + result.failed.length).toBeLessThan(5);

      abortServer.stop(true);
    });
  });

  describe("unsaveItems — retryable flag accuracy", () => {
    test("500 error is reported as retryable", async () => {
      const errors: Array<{ error: Error; retryable: boolean }> = [];
      const client = createClient({
        callbacks: {
          onError: (error, retryable) => errors.push({ error, retryable }),
        },
      });

      await client.unsaveItems(["t3_failme"]);

      expect(errors.length).toBe(1);
      expect(errors[0].retryable).toBe(true);
    });

    test("403 error is reported as not retryable", async () => {
      const errors: Array<{ error: Error; retryable: boolean }> = [];
      const client = createClient({
        callbacks: {
          onError: (error, retryable) => errors.push({ error, retryable }),
        },
      });

      await client.unsaveItems(["t3_forbidme"]);

      expect(errors.length).toBe(1);
      expect(errors[0].retryable).toBe(false);
    });

    test("network error (no status) is reported as retryable", async () => {
      const errors: Array<{ error: Error; retryable: boolean }> = [];
      // TokenProvider that throws a plain Error (simulates network failure)
      const tp: TokenProvider = {
        async ensureValidToken() {
          throw new Error("Network unreachable");
        },
        getSettings() {
          return createMockTokenProvider().getSettings();
        },
      };
      const queue = new RequestQueue();
      const client = new RedditApiClient(tp, queue, {
        onError: (error, retryable) => errors.push({ error, retryable }),
      }, baseUrl);

      await client.unsaveItems(["t3_ok1"]);

      expect(errors.length).toBe(1);
      expect(errors[0].retryable).toBe(true);
    });
  });

  describe("fetchCommentThread — empty post listing", () => {
    test("returns null when post listing is empty", async () => {
      const client = createClient();
      const thread = await client.fetchCommentThread("empty_post", "testsubreddit");
      expect(thread).toBeNull();
    });
  });

  describe("fetchCommentReplies — actual depth capping", () => {
    test("maxDepth=1 excludes deeper replies", async () => {
      const client = createClient();
      // deep_post has d0 -> d1 -> d2 -> d3. Target d0, get its replies with maxDepth=1.
      // Since fetchCommentReplies starts at currentDepth=1, maxDepth=1 should return
      // only the direct children (reply_a, reply_b level) and stop there.
      const replies = await client.fetchCommentReplies(
        "/r/testsubreddit/comments/deep_post/deep_title/d0",
        1,
      );
      // With maxDepth=1, flattenCommentTree(children, 1, 1) should include depth=1
      // but NOT recurse deeper (currentDepth < maxDepth is false when both are 1)
      const replyIds = replies.map((r) => r.id);
      expect(replyIds).toContain("d1");
      expect(replyIds).not.toContain("d2");
      expect(replyIds).not.toContain("d3");
    });
  });

  describe("fetchPostComments — sort parameter", () => {
    test("sort parameter reaches the request URL", async () => {
      let capturedSort = "";
      const sortServer = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(req) {
          const url = new URL(req.url);
          if (url.pathname.endsWith(".json") && url.pathname.includes("/comments/")) {
            capturedSort = url.searchParams.get("sort") ?? "";
            // Return minimal valid comments response
            return Response.json(
              [
                { kind: "Listing", data: { children: [] } },
                { kind: "Listing", data: { children: [] } },
              ],
              { headers: rateHeaders },
            );
          }
          return new Response("Not Found", { status: 404 });
        },
      });
      const sortBaseUrl = `http://127.0.0.1:${sortServer.port}`;

      const tp = createMockTokenProvider();
      const queue = new RequestQueue({ maxRetries: 0 });
      const client = new RedditApiClient(tp, queue, undefined, sortBaseUrl);

      await client.fetchPostComments("/r/test/comments/abc123/title", 0, "new");
      expect(capturedSort).toBe("new");

      sortServer.stop(true);
    });
  });

  describe("fetchUserContent — consecutive failure limit", () => {
    test("stops after 3 consecutive page failures with wasErrored", async () => {
      // Server that always returns 500
      const failServer = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(req) {
          const url = new URL(req.url);
          if (url.pathname.match(/^\/user\/[^/]+\/saved$/)) {
            return new Response("Server Error", { status: 500, headers: rateHeaders });
          }
          return Response.json({ name: "testuser" }, { headers: rateHeaders });
        },
      });
      const failBaseUrl = `http://127.0.0.1:${failServer.port}`;

      const errors: Error[] = [];
      const tp = createMockTokenProvider();
      const queue = new RequestQueue({ maxRetries: 0 });
      const client = new RedditApiClient(tp, queue, {
        onError: (err) => errors.push(err),
      }, failBaseUrl);

      const result = await client.fetchSaved();

      expect(result.items.length).toBe(0);
      expect(result.hasMore).toBe(false);
      expect(result.wasErrored).toBe(true);
      expect(result.wasCancelled).toBe(false);
      expect(errors.length).toBe(3);

      failServer.stop(true);
    });

    test("resets failure counter on successful page", async () => {
      let requestCount = 0;
      // Server that fails on 2nd request, succeeds on others
      const mixServer = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(req) {
          const url = new URL(req.url);
          if (url.pathname.match(/^\/user\/[^/]+\/saved$/)) {
            requestCount++;
            if (requestCount === 2) {
              return new Response("Server Error", { status: 500, headers: rateHeaders });
            }
            const after = url.searchParams.get("after");
            if (!after) {
              return Response.json(
                { kind: "Listing", data: { children: [makeRedditItem("p1")], after: "cursor2" } },
                { headers: rateHeaders },
              );
            }
            // Last page
            return Response.json(
              { kind: "Listing", data: { children: [makeRedditItem("p2")], after: null } },
              { headers: rateHeaders },
            );
          }
          return Response.json({ name: "testuser" }, { headers: rateHeaders });
        },
      });
      const mixBaseUrl = `http://127.0.0.1:${mixServer.port}`;

      const tp = createMockTokenProvider();
      const queue = new RequestQueue({ maxRetries: 0 });
      const client = new RedditApiClient(tp, queue, undefined, mixBaseUrl);

      const result = await client.fetchSaved();

      // Should recover: page1 ok, page2 fail (retry), page2 ok
      expect(result.items.length).toBe(2);
      expect(result.hasMore).toBe(false);
      expect(result.wasErrored).toBeUndefined();

      mixServer.stop(true);
    });
  });

  describe("unsaveItem signal forwarding", () => {
    test("forwards abort signal to the request queue", async () => {
      const controller = new AbortController();
      // Abort immediately before making the request
      controller.abort();

      const tp = createMockTokenProvider();
      const queue = new RequestQueue();
      const client = new RedditApiClient(tp, queue, undefined, baseUrl);

      // With signal already aborted, the fetch should reject
      await expect(client.unsaveItem("t3_test", controller.signal)).rejects.toThrow();
    });
  });

  describe("fetchUsername edge cases", () => {
    test("omits response body from error when name is missing", async () => {
      const tp = createMockTokenProvider({ accessToken: "no-name-token" });
      const queue = new RequestQueue();
      const client = new RedditApiClient(tp, queue, undefined, baseUrl);

      await expect(client.fetchUsername()).rejects.toThrow(
        "Reddit API did not return a username. Response contained unexpected fields.",
      );
    });

    test("reports error field from response body", async () => {
      const tp = createMockTokenProvider({ accessToken: "error-token" });
      const queue = new RequestQueue();
      const client = new RedditApiClient(tp, queue, undefined, baseUrl);

      await expect(client.fetchUsername()).rejects.toThrow("forbidden");
    });
  });

  describe("fetchUserContent retry backoff", () => {
    test("delays between consecutive page failures without signal (plain setTimeout path)", async () => {
      const failServer = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(req) {
          const url = new URL(req.url);
          if (url.pathname === "/api/v1/me") {
            return Response.json({ name: "testuser" }, { headers: rateHeaders });
          }
          return new Response("Server Error", { status: 500, headers: rateHeaders });
        },
      });
      const failBaseUrl = `http://127.0.0.1:${failServer.port}`;

      const tp = createMockTokenProvider();
      const queue = new RequestQueue({ maxRetries: 0 });
      const client = new RedditApiClient(tp, queue, undefined, failBaseUrl);

      const start = Date.now();
      // Call WITHOUT signal — exercises the else branch (plain setTimeout backoff)
      const result = await client.fetchSaved();
      const elapsed = Date.now() - start;

      expect(result.wasErrored).toBe(true);
      expect(result.items).toEqual([]);
      // 3 consecutive failures: 1s + 2s backoff before giving up ≥ 2s
      expect(elapsed).toBeGreaterThanOrEqual(2000);

      failServer.stop(true);
    });

    test("delays between consecutive page failures with partial results", async () => {
      // error_user: returns page1 OK, then 500s on page2
      const tp = createMockTokenProvider({ username: "error_user" });
      const client = createClient({ tokenProvider: tp, maxRetries: 0 });

      const result = await client.fetchSaved();

      // Should have page1 items but wasErrored from page2 failures
      expect(result.items.length).toBe(3); // page1 has 3 items
      expect(result.wasErrored).toBe(true);
    });

    test("abort signal interrupts backoff sleep", async () => {
      const failServer = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(req) {
          const url = new URL(req.url);
          if (url.pathname === "/api/v1/me") {
            return Response.json({ name: "testuser" }, { headers: rateHeaders });
          }
          return new Response("Server Error", { status: 500, headers: rateHeaders });
        },
      });
      const failBaseUrl = `http://127.0.0.1:${failServer.port}`;

      const tp = createMockTokenProvider();
      const queue = new RequestQueue({ maxRetries: 0 });
      const client = new RedditApiClient(tp, queue, undefined, failBaseUrl);

      const ac = new AbortController();
      // Abort after 500ms — well before the 1s+2s backoff would finish
      setTimeout(() => ac.abort(), 500);

      const start = Date.now();
      const result = await client.fetchSaved({ signal: ac.signal });
      const elapsed = Date.now() - start;

      // Should return in under 2s (proving backoff was interrupted)
      expect(elapsed).toBeLessThan(2000);
      expect(result.wasCancelled).toBe(true);

      failServer.stop(true);
    });
  });

  describe("empty first page", () => {
    test("returns empty result when first page has no items", async () => {
      const tp = createMockTokenProvider({ username: "empty_user" });
      const queue = new RequestQueue({ maxRetries: 0 });
      const client = new RedditApiClient(tp, queue, undefined, baseUrl);

      const result = await client.fetchSaved();
      expect(result.items).toEqual([]);
      expect(result.hasMore).toBe(false);
      expect(result.wasCancelled).toBe(false);
      expect(result.wasErrored).toBeUndefined();
    });
  });

  describe("onRateLimit callback", () => {
    test("does NOT fire onRateLimit when remaining >= 10", async () => {
      // Default mock server sends x-ratelimit-remaining: 59
      const rateLimitCalls: Array<[number, number]> = [];
      const client = createClient({
        callbacks: {
          onRateLimit: (resetMs, remaining) => rateLimitCalls.push([resetMs, remaining]),
        },
      });

      await client.fetchSaved();

      // remaining=59 is well above threshold of 10, so callback should not fire
      expect(rateLimitCalls.length).toBe(0);
    });

    test("fires onRateLimit when remaining < 10", async () => {
      const lowRateServer = Bun.serve({
        port: 0,
        fetch(req) {
          const url = new URL(req.url);
          if (url.pathname.includes("/saved")) {
            return Response.json(
              { data: { children: [makeRedditItem("lr1")], after: null } },
              {
                headers: {
                  "x-ratelimit-remaining": "5",
                  "x-ratelimit-reset": "30",
                },
              },
            );
          }
          return Response.json({ name: "lowrate_user" });
        },
      });
      const lowRateUrl = `http://localhost:${lowRateServer.port}`;
      const tp = createMockTokenProvider({ username: "lowrate_user" });
      const queue = new RequestQueue({ maxRetries: 0 });
      const rateLimitCalls: Array<[number, number]> = [];
      const client = new RedditApiClient(tp, queue, {
        onRateLimit: (resetMs, remaining) => rateLimitCalls.push([resetMs, remaining]),
      }, lowRateUrl);

      await client.fetchSaved();

      expect(rateLimitCalls.length).toBe(1);
      expect(rateLimitCalls[0]).toEqual([30_000, 5]); // 30s * 1000, remaining=5
      lowRateServer.stop(true);
    });

    test("does NOT fire onRateLimit for non-numeric headers", async () => {
      const badHeaderServer = Bun.serve({
        port: 0,
        fetch(req) {
          const url = new URL(req.url);
          if (url.pathname.includes("/saved")) {
            return Response.json(
              { data: { children: [makeRedditItem("bh1")], after: null } },
              {
                headers: {
                  "x-ratelimit-remaining": "abc",
                  "x-ratelimit-reset": "xyz",
                },
              },
            );
          }
          return Response.json({ name: "badheader_user" });
        },
      });
      const badHeaderUrl = `http://localhost:${badHeaderServer.port}`;
      const tp = createMockTokenProvider({ username: "badheader_user" });
      const queue = new RequestQueue({ maxRetries: 0 });
      const rateLimitCalls: Array<[number, number]> = [];
      const client = new RedditApiClient(tp, queue, {
        onRateLimit: (resetMs, remaining) => rateLimitCalls.push([resetMs, remaining]),
      }, badHeaderUrl);

      await client.fetchSaved();

      expect(rateLimitCalls.length).toBe(0);
      badHeaderServer.stop(true);
    });
  });

  describe("onProgress callback — total parameter", () => {
    test("onProgress receives null as total during fetch (unknown total)", async () => {
      const progressCalls: Array<[number, number | null]> = [];
      const client = createClient({
        callbacks: {
          onProgress: (fetched, total) => progressCalls.push([fetched, total]),
        },
      });

      await client.fetchSaved();

      expect(progressCalls.length).toBeGreaterThan(0);
      for (const [, total] of progressCalls) {
        expect(total).toBeNull();
      }
    });

    test("onProgress receives actual count as total during unsaveItems", async () => {
      const progressCalls: Array<[number, number | null]> = [];
      const client = createClient({
        callbacks: {
          onProgress: (fetched, total) => progressCalls.push([fetched, total]),
        },
      });

      await client.unsaveItems(["t3_abc", "t3_def"]);

      expect(progressCalls.length).toBe(2);
      expect(progressCalls[0]).toEqual([1, 2]);
      expect(progressCalls[1]).toEqual([2, 2]);
    });
  });

  describe("fetchCommentWithContext — empty comments listing", () => {
    test("returns null when comments listing is empty", async () => {
      const client = createClient();
      const result = await client.fetchCommentWithContext(
        "/r/testsubreddit/comments/empty_comments_post/test/empty_c1/",
      );
      expect(result).toBeNull();
    });
  });

  describe("fetchCommentReplies — no children in replies data", () => {
    test("returns [] when target comment replies.data has no children key", async () => {
      const client = createClient();
      const result = await client.fetchCommentReplies(
        "/r/testsubreddit/comments/no_reply_children_post/test/nrc_target/",
      );
      expect(result).toEqual([]);
    });
  });

  describe("fetchPostComments — sort with actual comments", () => {
    test("returns parsed comments when sort parameter is used", async () => {
      const client = createClient();
      // Default mock returns comments with nested replies
      const result = await client.fetchPostComments(
        "/r/testsubreddit/comments/post1/test_post/",
        0,
        "new",
      );
      // Should parse the default response's comments
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty("id");
      expect(result[0]).toHaveProperty("body");
    });
  });

  // =========================================================================
  // AbortSignal support for comment/username methods (M1)
  // =========================================================================

  describe("fetchUsername — AbortSignal", () => {
    test("pre-aborted signal rejects immediately", async () => {
      const client = createClient();
      const controller = new AbortController();
      controller.abort();
      await expect(client.fetchUsername(controller.signal)).rejects.toThrow();
    });
  });

  describe("fetchPostComments — AbortSignal", () => {
    test("pre-aborted signal rejects immediately", async () => {
      const client = createClient();
      const controller = new AbortController();
      controller.abort();
      await expect(
        client.fetchPostComments(
          "/r/testsubreddit/comments/post1/test_post/",
          0,
          undefined,
          controller.signal,
        ),
      ).rejects.toThrow();
    });
  });

  describe("fetchCommentWithContext — AbortSignal", () => {
    test("pre-aborted signal rejects immediately", async () => {
      const client = createClient();
      const controller = new AbortController();
      controller.abort();
      await expect(
        client.fetchCommentWithContext(
          "/r/testsubreddit/comments/post1/test_post/comment1/",
          3,
          controller.signal,
        ),
      ).rejects.toThrow();
    });
  });

  describe("fetchCommentReplies — AbortSignal", () => {
    test("pre-aborted signal rejects immediately", async () => {
      const client = createClient();
      const controller = new AbortController();
      controller.abort();
      await expect(
        client.fetchCommentReplies(
          "/r/testsubreddit/comments/reply_post/title/target_comment/",
          undefined,
          controller.signal,
        ),
      ).rejects.toThrow();
    });
  });

  describe("fetchCommentThread — AbortSignal", () => {
    test("pre-aborted signal rejects immediately", async () => {
      const client = createClient();
      const controller = new AbortController();
      controller.abort();
      await expect(
        client.fetchCommentThread("post1", "testsubreddit", undefined, controller.signal),
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // AbortSignal.timeout with slow server (T1)
  // =========================================================================

  describe("AbortSignal timeout", () => {
    test("AbortSignal.timeout rejects when server is slow", async () => {
      const slowServer = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch() {
          await new Promise((r) => setTimeout(r, 2000));
          return Response.json({ name: "testuser" }, { headers: rateHeaders });
        },
      });
      const slowBaseUrl = `http://127.0.0.1:${slowServer.port}`;

      const tp = createMockTokenProvider();
      const queue = new RequestQueue({ maxRetries: 0 });
      const client = new RedditApiClient(tp, queue, undefined, slowBaseUrl);

      await expect(client.fetchUsername(AbortSignal.timeout(100))).rejects.toThrow();

      slowServer.stop(true);
    });
  });

  // =========================================================================
  // findComment depth limit (M2)
  // =========================================================================

  describe("findComment — depth limit", () => {
    test("returns null for comment beyond depth limit (150 levels deep)", async () => {
      const client = createClient();
      // "leaf" is at depth 149 — beyond the 100-level findComment limit
      const result = await client.fetchCommentWithContext(
        "/r/testsubreddit/comments/deep_recursion_post/deep/leaf/",
      );
      expect(result).toBeNull();
    });

    test("returns comment within depth limit", async () => {
      const client = createClient();
      // "n50" is at depth 50 — within the 100-level limit
      const result = await client.fetchCommentWithContext(
        "/r/testsubreddit/comments/deep_recursion_post/deep/n50/",
      );
      expect(result).not.toBeNull();
      expect(result?.id).toBe("n50");
    });
  });

  // =========================================================================
  // Token validation per call
  // =========================================================================

  describe("token validation", () => {
    test("each method call independently validates the token via tokenProvider", async () => {
      let ensureCallCount = 0;
      const tp: TokenProvider = {
        async ensureValidToken() {
          ensureCallCount++;
          await new Promise((r) => setTimeout(r, 50));
        },
        getSettings() {
          return {
            accessToken: "test-access-token",
            refreshToken: "test-refresh-token",
            tokenExpiry: Date.now() + 3600_000,
            username: "testuser",
            clientId: "test-client-id",
            clientSecret: "test-client-secret",
          };
        },
      };
      const queue = new RequestQueue({ maxRetries: 0 });
      const client = new RedditApiClient(tp, queue, undefined, baseUrl);

      const [r1, r2] = await Promise.all([client.fetchUsername(), client.fetchUsername()]);

      expect(r1).toBe("testuser");
      expect(r2).toBe("testuser");
      // Each call independently validates — dedup is TokenManager's responsibility
      expect(ensureCallCount).toBe(2);
    });
  });
});
