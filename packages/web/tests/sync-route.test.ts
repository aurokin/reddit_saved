import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAppContext, getAppContext } from "@/api/context";
import syncRoute from "@/api/routes/sync";
import {
  type AuthProvider,
  type FetchOptions,
  type FetchResult,
  RedditApiClient,
  SyncStateManager,
} from "@reddit-saved/core";

let tempDir: string | null = null;

function makeSyncRequest(
  path: string,
  origin: string | null = "http://localhost:3001",
  referer: string | null = null,
): Request {
  return new Request(`http://localhost${path}`, {
    method: "GET",
    headers: {
      ...(origin ? { origin } : {}),
      ...(referer ? { referer } : {}),
    },
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}

function makeCancelRequest(origin: string | null = "http://localhost:3001"): Request {
  return new Request("http://localhost/cancel", {
    method: "POST",
    headers: origin ? { origin } : undefined,
  });
}

describe("sync route", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "reddit-saved-web-sync-"));
    process.env.TEST_MODE = "1";
    process.env.REDDIT_SAVED_DB = join(tempDir, "test.db");
  });

  afterEach(() => {
    closeAppContext();
    process.env.TEST_MODE = undefined;
    process.env.REDDIT_SAVED_DB = undefined;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  test("accepts GET /fetch so EventSource clients hit the sync route", async () => {
    const res = await syncRoute.fetch(makeSyncRequest("/fetch?type=saved&full=false"));

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Sync is disabled in TEST_MODE");
  });

  test("accepts headerless GET /fetch so EventSource-style clients can sync", async () => {
    const res = await syncRoute.fetch(makeSyncRequest("/fetch?type=saved&full=false", null));

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Sync is disabled in TEST_MODE");
  });

  test("accepts empty-Origin GET /fetch when the Referer is loopback", async () => {
    const res = await syncRoute.fetch(
      makeSyncRequest("/fetch?type=saved&full=false", null, "http://localhost:3001/app"),
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Sync is disabled in TEST_MODE");
  });

  test("accepts the canonical commented sync type", async () => {
    const res = await syncRoute.fetch(makeSyncRequest("/fetch?type=commented&full=false"));

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Sync is disabled in TEST_MODE");
  });

  test("accepts the legacy comments alias for compatibility", async () => {
    const res = await syncRoute.fetch(makeSyncRequest("/fetch?type=comments&full=false"));

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Sync is disabled in TEST_MODE");
  });

  test("rejects unknown sync types instead of falling back to saved", async () => {
    const res = await syncRoute.fetch(makeSyncRequest("/fetch?type=unknown&full=false"));

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Invalid sync type");
  });

  test("rejects cross-origin sync fetch requests before starting sync work", async () => {
    const res = await syncRoute.fetch(
      makeSyncRequest("/fetch?type=saved&full=false", "https://evil.example"),
    );

    expect(res.status).toBe(403);
    expect(await res.text()).toContain("Origin not permitted");
    expect(getAppContext().activeSync).toBeNull();
  });

  test("rejects empty-Origin sync fetch requests with a foreign Referer", async () => {
    const res = await syncRoute.fetch(
      makeSyncRequest("/fetch?type=saved&full=false", null, "https://evil.example/feed"),
    );

    expect(res.status).toBe(403);
    expect(await res.text()).toContain("Origin not permitted: https://evil.example/feed");
    expect(getAppContext().activeSync).toBeNull();
  });

  test("cancel endpoint aborts the active sync", async () => {
    process.env.TEST_MODE = undefined;
    const ctx = getAppContext();
    const originalFetchSaved = RedditApiClient.prototype.fetchSaved;
    const originalCreatePinnedProvider = ctx.authProvider.createPinnedProvider.bind(
      ctx.authProvider,
    );
    const fakeProvider: AuthProvider = {
      ensureValid: async () => {},
      getAuthContext: () => ({
        headers: {},
        baseUrl: "http://localhost",
        pathSuffix: "",
        username: "tester",
      }),
      isAuthenticated: () => true,
    };

    let receivedSignal: AbortSignal | undefined;
    let releaseFetch: ((result: FetchResult) => void) | undefined;
    ctx.authProvider.createPinnedProvider = async () => fakeProvider;
    RedditApiClient.prototype.fetchSaved = (options?: FetchOptions): Promise<FetchResult> => {
      receivedSignal = options?.signal;
      return new Promise((resolve) => {
        releaseFetch = resolve;
      });
    };

    const res = await syncRoute.fetch(makeSyncRequest("/fetch?type=saved&full=false"));

    expect(res.status).toBe(200);
    expect(ctx.activeSync).not.toBeNull();
    const responseDone = res.text();
    await waitFor(() => receivedSignal !== undefined);

    const cancelRes = await syncRoute.fetch(makeCancelRequest(null));
    expect(cancelRes.status).toBe(200);
    expect(receivedSignal?.aborted).toBe(true);

    releaseFetch?.({ items: [], cursor: null, hasMore: false, wasCancelled: true });
    await waitFor(() => ctx.activeSync === null);
    await responseDone;

    RedditApiClient.prototype.fetchSaved = originalFetchSaved;
    ctx.authProvider.createPinnedProvider = originalCreatePinnedProvider;
  });

  test("rejects cross-origin cancel requests before aborting the active sync", async () => {
    const ctx = getAppContext();
    ctx.activeSync = new AbortController();

    const res = await syncRoute.fetch(makeCancelRequest("https://evil.example"));

    expect(res.status).toBe(403);
    expect(await res.text()).toContain("Origin not permitted");
    expect(ctx.activeSync.signal.aborted).toBe(false);
  });

  test("clears activeSync when checkpoint loading fails", async () => {
    process.env.TEST_MODE = undefined;
    const ctx = getAppContext();
    const originalLoad = SyncStateManager.prototype.load;

    try {
      SyncStateManager.prototype.load = async () => {
        throw new Error("checkpoint unreadable");
      };

      const res = await syncRoute.fetch(makeSyncRequest("/fetch?type=saved&full=false"));

      expect(res.status).toBe(200);
      expect(await res.text()).toContain("checkpoint unreadable");
      expect(ctx.activeSync).toBeNull();
    } finally {
      SyncStateManager.prototype.load = originalLoad;
    }

    const retryRes = await syncRoute.fetch(makeSyncRequest("/fetch?type=saved&full=false"));
    expect(retryRes.status).not.toBe(409);
    expect(await retryRes.text()).not.toContain("A sync is already in progress");
    expect(ctx.activeSync).toBeNull();
  });
});
