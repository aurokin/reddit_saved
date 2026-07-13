import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { RedditApiClient, type RedditItemData, SqliteAdapter } from "@reddit-cached/core";
import { setOutputMode } from "../src/output";
import { captureConsole, makeTempDb, restoreFetch } from "./helpers";

const originalEnv = { ...process.env };

describe("fetch context command", () => {
  let dbPath: string;
  let tempDir: string;

  beforeEach(() => {
    dbPath = makeTempDb();
    tempDir = dirname(dbPath);
    setOutputMode(false, false, false);

    const configDir = join(tempDir, "reddit-cached");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "auth.json"),
      JSON.stringify({
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token",
        tokenExpiry: Date.now() + 3600_000,
        username: "testuser",
        clientId: "test-client-id",
      }),
    );

    process.env.REDDIT_SAVED_CONFIG_DIR = configDir;
    process.env.XDG_DATA_HOME = tempDir;
    process.env.REDDIT_CLIENT_SECRET = "test-secret";
  });

  afterEach(() => {
    restoreFetch();
    setOutputMode(false, false, false);
    for (const key of ["REDDIT_SAVED_CONFIG_DIR", "XDG_DATA_HOME", "REDDIT_CLIENT_SECRET"]) {
      if (originalEnv[key] !== undefined) {
        process.env[key] = originalEnv[key];
      } else {
        delete process.env[key];
      }
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("captures context for saved posts and stamps them", async () => {
    // Seed one saved post
    const seed = new SqliteAdapter(dbPath);
    seed.upsertPosts(
      [
        {
          kind: "t3",
          data: {
            id: "sp1",
            name: "t3_sp1",
            title: "Saved post",
            author: "op",
            subreddit: "testsub",
            permalink: "/r/testsub/comments/sp1/saved_post/",
            created_utc: 1700000000,
            score: 10,
          },
        },
      ],
      "saved",
    );
    seed.close();

    const threadComment: RedditItemData = {
      id: "tc1",
      name: "t1_tc1",
      author: "commenter",
      subreddit: "testsub",
      permalink: "/r/testsub/comments/sp1/saved_post/tc1/",
      created_utc: 1700000050,
      score: 25,
      body: "top comment",
      parent_id: "t3_sp1",
      link_id: "t3_sp1",
    };

    const originalFetchCommentThread = RedditApiClient.prototype.fetchCommentThread;
    RedditApiClient.prototype.fetchCommentThread = async () => ({
      post: { id: "sp1" } as RedditItemData,
      comments: [threadComment],
      totalComments: 1,
      hasMore: false,
    });

    const { fetchContextCmd } = await import("../src/commands/fetch-context");
    const cap = captureConsole();
    try {
      await fetchContextCmd({ db: dbPath }, []);
      const output = JSON.parse(cap.logs[0]);
      expect(output.processed).toBe(1);
      expect(output.captured).toBe(1);
      expect(output.contextItemsStored).toBe(1);
      expect(output.remaining).toBe(0);
    } finally {
      RedditApiClient.prototype.fetchCommentThread = originalFetchCommentThread;
      cap.restore();
    }

    const adapter = new SqliteAdapter(dbPath);
    try {
      expect(adapter.getPost("tc1")?.content_origin).toBe("context");
      expect(adapter.getPost("sp1")?.context_fetched_at).toBeGreaterThan(0);
      // Default views stay clean of context rows
      expect(adapter.listPosts({}).map((r) => r.id)).toEqual(["sp1"]);
    } finally {
      adapter.close();
    }
  });
});
