import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, paths } from "../src";

const originalFetch = globalThis.fetch;
const originalConfigDir = process.env.REDDIT_SAVED_CONFIG_DIR;

describe("SessionManager", () => {
  let configDir: string;
  let manager: SessionManager;

  beforeEach(async () => {
    configDir = mkdtempSync(join(tmpdir(), "reddit-saved-session-test-"));
    process.env.REDDIT_SAVED_CONFIG_DIR = configDir;
    manager = new SessionManager();
    globalThis.fetch = mock(async () =>
      Response.json({
        data: {
          name: "session-user",
          modhash: "modhash",
        },
      }),
    ) as typeof fetch;
    await manager.ingest({
      cookieHeader: "reddit_session=abc123",
      userAgent: "unit-test-agent",
      capturedAt: 1,
    });
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await manager.clear();
    rmSync(configDir, { recursive: true, force: true });
    if (originalConfigDir === undefined) {
      process.env.REDDIT_SAVED_CONFIG_DIR = undefined;
    } else {
      process.env.REDDIT_SAVED_CONFIG_DIR = originalConfigDir;
    }
  });

  test("clears stale sessions when reddit rejects the saved cookies", async () => {
    globalThis.fetch = mock(
      async () => new Response("unauthorized", { status: 401 }),
    ) as typeof fetch;

    let thrown: unknown;
    try {
      await manager.ensureValid();
    } catch (err) {
      thrown = err;
    }

    expect((thrown as Error & { code?: string })?.code).toBe("SESSION_INVALID");
    expect(manager.isAuthenticated()).toBe(false);
    expect(await Bun.file(paths.sessionFile).exists()).toBe(false);
  });

  test("preserves the session on transient verification failures", async () => {
    globalThis.fetch = mock(
      async () => new Response("server error", { status: 503 }),
    ) as typeof fetch;

    await expect(manager.ensureValid()).rejects.toThrow("Session verification failed: HTTP 503");
    expect(manager.isAuthenticated()).toBe(true);
    expect(await Bun.file(paths.sessionFile).exists()).toBe(true);
  });

  test("ingest derives username and modhash from the submitted cookie jar", async () => {
    const fetchMock = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("cookie")).toBe("reddit_session=fresh");
      expect(headers.get("user-agent")).toBe("unit-test-agent");
      expect(headers.get("accept")).toBe("application/json");
      return Response.json({
        data: {
          name: "fresh-user",
          modhash: "fresh-modhash",
        },
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const settings = await manager.ingest({
      cookieHeader: "reddit_session=fresh",
      userAgent: "unit-test-agent",
      capturedAt: 2,
    });

    expect(settings).toEqual({
      cookieHeader: "reddit_session=fresh",
      userAgent: "unit-test-agent",
      username: "fresh-user",
      modhash: "fresh-modhash",
      capturedAt: 2,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("caches successful verification across repeated ensureValid calls", async () => {
    const fetchMock = mock(async () =>
      Response.json({
        data: {
          name: "session-user",
          modhash: "fresh-modhash",
        },
      }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await manager.ensureValid();
    await manager.ensureValid();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("preserves capturedAt when verification refreshes the modhash", async () => {
    const fetchMock = mock(async () =>
      Response.json({
        data: {
          name: "session-user",
          modhash: "fresh-modhash",
        },
      }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await manager.ensureValid();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(manager.getSummary()).toEqual({
      username: "session-user",
      capturedAt: 1,
    });
    expect(manager.getAuthContext().headers["x-modhash"]).toBe("fresh-modhash");
    await expect(Bun.file(paths.sessionFile).json()).resolves.toMatchObject({
      username: "session-user",
      modhash: "fresh-modhash",
      capturedAt: 1,
    });
  });

  test("shares an in-flight verification across concurrent ensureValid calls", async () => {
    let resolveFetch: (() => void) | null = null;
    const fetchMock = mock(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = () =>
            resolve(
              Response.json({
                data: {
                  name: "session-user",
                  modhash: "fresh-modhash",
                },
              }),
            );
        }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const pendingA = manager.ensureValid();
    const pendingB = manager.ensureValid();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFetch?.();

    await Promise.all([pendingA, pendingB]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("does not restore the session when disconnect happens during verification", async () => {
    let markFetchStarted: (() => void) | null = null;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    let resolveFetch: (() => void) | null = null;
    const fetchMock = mock(
      () =>
        new Promise<Response>((resolve) => {
          markFetchStarted?.();
          resolveFetch = () =>
            resolve(
              Response.json({
                data: {
                  name: "session-user",
                  modhash: "fresh-modhash",
                },
              }),
            );
        }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const verifyPromise = manager.ensureValid();

    await fetchStarted;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await manager.disconnect();
    resolveFetch?.();

    await expect(verifyPromise).rejects.toMatchObject({ code: "SESSION_BLOCKED" });
    expect(manager.isAuthenticated()).toBe(false);
    expect(await Bun.file(paths.sessionFile).exists()).toBe(false);
    await expect(manager.load()).resolves.toBeNull();
    expect(await Bun.file(paths.sessionBlockFile).exists()).toBe(true);
  });

  test("does not restore the session when clear happens during verification", async () => {
    let markFetchStarted: (() => void) | null = null;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    let resolveFetch: (() => void) | null = null;
    const fetchMock = mock(
      () =>
        new Promise<Response>((resolve) => {
          markFetchStarted?.();
          resolveFetch = () =>
            resolve(
              Response.json({
                data: {
                  name: "session-user",
                  modhash: "fresh-modhash",
                },
              }),
            );
        }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const verifyPromise = manager.ensureValid();

    await fetchStarted;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await manager.clear();
    resolveFetch?.();

    await expect(verifyPromise).rejects.toThrow(
      "No active session. Install the companion extension.",
    );
    expect(manager.isAuthenticated()).toBe(false);
    expect(await Bun.file(paths.sessionFile).exists()).toBe(false);
    await expect(manager.load()).resolves.toBeNull();
    expect(await Bun.file(paths.sessionBlockFile).exists()).toBe(false);
  });

  test("blocks extension ingest after disconnect until reconnect is requested", async () => {
    await manager.disconnect();

    expect(manager.isAuthenticated()).toBe(false);
    expect(await Bun.file(paths.sessionFile).exists()).toBe(false);
    expect(await Bun.file(paths.sessionBlockFile).exists()).toBe(true);

    let blockedError: unknown;
    try {
      await manager.ingest({
        cookieHeader: "reddit_session=new-cookie",
        userAgent: "unit-test-agent",
        capturedAt: 2,
      });
    } catch (err) {
      blockedError = err;
    }

    expect((blockedError as Error & { code?: string })?.code).toBe("SESSION_BLOCKED");
    expect(await Bun.file(paths.sessionFile).exists()).toBe(false);

    await manager.reconnect();
    globalThis.fetch = mock(async () =>
      Response.json({
        data: {
          name: "session-user",
          modhash: "modhash",
        },
      }),
    ) as typeof fetch;
    const restored = await manager.ingest({
      cookieHeader: "reddit_session=new-cookie",
      userAgent: "unit-test-agent",
      capturedAt: 2,
    });

    expect(restored.username).toBe("session-user");
    expect(await Bun.file(paths.sessionBlockFile).exists()).toBe(false);
    expect(await Bun.file(paths.sessionFile).exists()).toBe(true);
  });

  test("does not restore the session when disconnect happens during ingest verification", async () => {
    let markFetchStarted: (() => void) | null = null;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    let resolveFetch: (() => void) | null = null;
    const fetchMock = mock(
      () =>
        new Promise<Response>((resolve) => {
          markFetchStarted?.();
          resolveFetch = () =>
            resolve(
              Response.json({
                data: {
                  name: "session-user",
                  modhash: "fresh-modhash",
                },
              }),
            );
        }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const ingestPromise = manager.ingest({
      cookieHeader: "reddit_session=racing-cookie",
      userAgent: "unit-test-agent",
      capturedAt: 2,
    });

    await fetchStarted;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await manager.disconnect();
    resolveFetch?.();

    await expect(ingestPromise).rejects.toMatchObject({ code: "SESSION_BLOCKED" });
    expect(manager.isAuthenticated()).toBe(false);
    expect(await Bun.file(paths.sessionFile).exists()).toBe(false);
    expect(await Bun.file(paths.sessionBlockFile).exists()).toBe(true);
  });
});
