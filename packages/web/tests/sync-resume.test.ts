import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeAppContext, getAppContext } from "@/api/context";
import syncRoute from "@/api/routes/sync";
import {
  getCheckpointPathForDatabase,
  RedditApiClient,
  SyncStateManager,
  type AuthProvider,
  type FetchOptions,
  type RedditItem,
} from "@reddit-saved/core";

function makeItem(id: string): RedditItem {
  return {
    kind: "t3",
    data: {
      id,
      name: `t3_${id}`,
      title: `Post ${id}`,
      author: "tester",
      subreddit: "test",
      permalink: `/r/test/comments/${id}/post_${id}/`,
      created_utc: 1_700_000_000,
      score: 1,
    },
  };
}

describe("sync route checkpoint recovery", () => {
  let tempDir: string;
  let ctx: ReturnType<typeof getAppContext>;
  let originalFetchSaved: typeof RedditApiClient.prototype.fetchSaved;
  let originalCreatePinnedProvider: ReturnType<typeof getAppContext>["authProvider"]["createPinnedProvider"];
  const fakeProvider: AuthProvider = {
    ensureValid: async () => {},
    getAuthContext: () => ({ headers: {}, baseUrl: "http://localhost", pathSuffix: "", username: "tester" }),
    isAuthenticated: () => true,
  };

  function bootApp(dbPath: string): void {
    closeAppContext();
    process.env.REDDIT_SAVED_DB = dbPath;
    ctx = getAppContext();
    originalCreatePinnedProvider = ctx.authProvider.createPinnedProvider.bind(ctx.authProvider);
    ctx.authProvider.createPinnedProvider = async () => fakeProvider;
  }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "reddit-saved-web-sync-resume-"));
    process.env.XDG_DATA_HOME = join(tempDir, "data");
    bootApp(join(tempDir, "test.db"));
    originalFetchSaved = RedditApiClient.prototype.fetchSaved;
  });

  afterEach(() => {
    RedditApiClient.prototype.fetchSaved = originalFetchSaved;
    ctx.authProvider.createPinnedProvider = originalCreatePinnedProvider;
    closeAppContext();
    delete process.env.REDDIT_SAVED_DB;
    delete process.env.XDG_DATA_HOME;
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("resumes a full sync from a saved checkpoint cursor", async () => {
    ctx.storage.setSyncState("last_cursor_saved", "stored_incremental_cursor");

    const stateManager = new SyncStateManager(getCheckpointPathForDatabase(ctx.dbPath));
    const checkpoint = stateManager.createNew(undefined, { contentOrigin: "saved", isFull: true });
    checkpoint.cursor = "checkpoint_cursor_999";
    checkpoint.totalFetched = 7;
    await stateManager.save(checkpoint);

    let receivedStartCursor: string | undefined;
    RedditApiClient.prototype.fetchSaved = async function (options?: FetchOptions) {
      receivedStartCursor = options?.startCursor;
      return { items: [], cursor: null, hasMore: false, wasCancelled: false };
    };

    const res = await syncRoute.fetch(
      new Request("http://localhost/fetch?type=saved&full=true", { method: "GET" }),
    );

    expect(res.status).toBe(200);
    await res.text();
    expect(receivedStartCursor).toBe("checkpoint_cursor_999");
    expect(await stateManager.load()).toBeNull();
  });

  test("preserves the updated checkpoint after an incomplete incremental sync", async () => {
    const stateManager = new SyncStateManager(getCheckpointPathForDatabase(ctx.dbPath));

    RedditApiClient.prototype.fetchSaved = async function () {
      return {
        items: [makeItem("partial1")],
        cursor: "resume_after_page1",
        hasMore: true,
        wasCancelled: false,
        wasErrored: true,
      };
    };

    const res = await syncRoute.fetch(
      new Request("http://localhost/fetch?type=saved&full=false", { method: "GET" }),
    );

    expect(res.status).toBe(200);
    await res.text();

    const checkpoint = await stateManager.load();
    expect(checkpoint?.cursor).toBe("resume_after_page1");
    expect(checkpoint?.totalFetched).toBe(1);
    expect(ctx.storage.getSyncState("last_cursor_saved")).toBe("resume_after_page1");
  });

  test("does not reuse a checkpoint from a different database", async () => {
    const firstDbPath = join(tempDir, "first", "test.db");
    const secondDbPath = join(tempDir, "second", "test.db");

    bootApp(firstDbPath);
    const firstStateManager = new SyncStateManager(getCheckpointPathForDatabase(firstDbPath));
    const checkpoint = firstStateManager.createNew(undefined, {
      contentOrigin: "saved",
      isFull: true,
    });
    checkpoint.cursor = "checkpoint_cursor_999";
    checkpoint.totalFetched = 7;
    await firstStateManager.save(checkpoint);

    bootApp(secondDbPath);

    let receivedStartCursor: string | undefined;
    RedditApiClient.prototype.fetchSaved = async function (options?: FetchOptions) {
      receivedStartCursor = options?.startCursor;
      return { items: [], cursor: null, hasMore: false, wasCancelled: false };
    };

    const res = await syncRoute.fetch(
      new Request("http://localhost/fetch?type=saved&full=true", { method: "GET" }),
    );

    expect(res.status).toBe(200);
    await res.text();
    expect(receivedStartCursor).toBeUndefined();
    expect(await firstStateManager.load()).not.toBeNull();
    expect(
      await new SyncStateManager(getCheckpointPathForDatabase(secondDbPath)).load(),
    ).toBeNull();
  });
});
