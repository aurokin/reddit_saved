import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAppContext, getAppContext } from "@/api/context";
import syncRoute from "@/api/routes/sync";
import type { AuthProvider } from "@reddit-cached/core";

const originalConfigDir = process.env.REDDIT_SAVED_CONFIG_DIR;

function makeRequest(origin: string | null = "http://localhost:3001"): Request {
  return new Request("http://localhost/context", {
    method: "GET",
    headers: origin ? { origin } : {},
  });
}

describe("sync context route", () => {
  let tempDir: string | null = null;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "reddit-cached-web-ctx-"));
    process.env.TEST_MODE = "1";
    process.env.REDDIT_SAVED_DB = join(tempDir, "test.db");
    process.env.REDDIT_SAVED_CONFIG_DIR = join(tempDir, "config");
  });

  afterEach(() => {
    closeAppContext();
    process.env.TEST_MODE = undefined;
    process.env.REDDIT_SAVED_DB = undefined;
    if (originalConfigDir === undefined) {
      Reflect.deleteProperty(process.env, "REDDIT_SAVED_CONFIG_DIR");
    } else {
      process.env.REDDIT_SAVED_CONFIG_DIR = originalConfigDir;
    }
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  test("is disabled in TEST_MODE like /fetch", async () => {
    const res = await syncRoute.fetch(makeRequest());

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Sync is disabled in TEST_MODE");
  });

  test("rejects cross-origin requests before starting work", async () => {
    const res = await syncRoute.fetch(makeRequest("https://evil.example"));

    expect(res.status).toBe(403);
    expect(await res.text()).toContain("Origin not permitted");
    expect(getAppContext().activeSync).toBeNull();
  });

  test("returns 409 when a sync is already running", async () => {
    process.env.TEST_MODE = undefined;
    const ctx = getAppContext();
    ctx.activeSync = new AbortController();

    const res = await syncRoute.fetch(makeRequest());

    expect(res.status).toBe(409);
    expect(await res.text()).toContain("already in progress");
    ctx.activeSync = null;
  });

  test("streams complete and clears activeSync when there is no backlog", async () => {
    process.env.TEST_MODE = undefined;
    const ctx = getAppContext();
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
    const originalCreatePinnedProvider = ctx.authProvider.createPinnedProvider.bind(
      ctx.authProvider,
    );
    ctx.authProvider.createPinnedProvider = async () => fakeProvider;

    try {
      // Empty database → no context candidates → syncContext returns without
      // touching the network.
      const res = await syncRoute.fetch(makeRequest());

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("event: starting");
      expect(body).toContain('"origin":"context"');
      expect(body).toContain("event: complete");
      expect(ctx.activeSync).toBeNull();
    } finally {
      ctx.authProvider.createPinnedProvider = originalCreatePinnedProvider;
    }
  });
});
