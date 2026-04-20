import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAppContext, getAppContext } from "@/api/context";
import authRoute from "@/api/routes/auth";
import { REDDIT_BASE_URL, REDDIT_OAUTH_BASE_URL, RedditApiClient, paths } from "@reddit-saved/core";

const originalFetch = globalThis.fetch;
const originalConfigDir = process.env.REDDIT_SAVED_CONFIG_DIR;
const originalDataDir = process.env.XDG_DATA_HOME;
const originalClientSecret = process.env.REDDIT_CLIENT_SECRET;
const originalTestMode = process.env.TEST_MODE;
const originalDateNow = Date.now;

describe("session auth fallback", () => {
  let tempDir: string;

  function makeLoginRequest(origin?: string | null, referer?: string | null): Request {
    return new Request("http://localhost/login", {
      method: "POST",
      headers: {
        ...(origin ? { origin } : {}),
        ...(referer ? { referer } : {}),
      },
    });
  }

  function seedSession(username = "session-user") {
    writeFileSync(
      paths.sessionFile,
      JSON.stringify({
        cookieHeader: "reddit_session=expired",
        userAgent: "unit-test-agent",
        username,
        modhash: "modhash",
        capturedAt: 1,
      }),
    );
  }

  function seedOAuth(username = "oauth-user", tokenExpiry = Date.now() + 3_600_000) {
    writeFileSync(
      paths.authFile,
      JSON.stringify({
        accessToken: "oauth-access",
        refreshToken: "oauth-refresh",
        clientId: "client-id",
        clientSecret: "client-secret",
        tokenExpiry,
        username,
      }),
    );
  }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "reddit-saved-web-auth-"));
    process.env.REDDIT_SAVED_CONFIG_DIR = join(tempDir, "config");
    process.env.XDG_DATA_HOME = join(tempDir, "data");
    process.env.REDDIT_SAVED_DB = join(tempDir, "test.db");

    mkdirSync(paths.config, { recursive: true });
    seedSession();
    seedOAuth();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    closeAppContext();
    process.env.REDDIT_SAVED_DB = undefined;
    if (originalConfigDir === undefined) {
      process.env.REDDIT_SAVED_CONFIG_DIR = undefined;
    } else {
      process.env.REDDIT_SAVED_CONFIG_DIR = originalConfigDir;
    }
    if (originalDataDir === undefined) {
      process.env.XDG_DATA_HOME = undefined;
    } else {
      process.env.XDG_DATA_HOME = originalDataDir;
    }
    if (originalClientSecret === undefined) {
      process.env.REDDIT_CLIENT_SECRET = undefined;
    } else {
      process.env.REDDIT_CLIENT_SECRET = originalClientSecret;
    }
    if (originalTestMode === undefined) {
      process.env.TEST_MODE = undefined;
    } else {
      process.env.TEST_MODE = originalTestMode;
    }
    Date.now = originalDateNow;
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("falls back to OAuth when persisted session cookies are stale for the same account", async () => {
    seedOAuth("session-user");
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === `${REDDIT_BASE_URL}/api/me.json`) {
        return new Response("unauthorized", { status: 401 });
      }
      if (url === `${REDDIT_OAUTH_BASE_URL}/api/v1/me`) {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer oauth-access");
        return Response.json({ name: "session-user" });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const ctx = getAppContext();
    const username = await ctx.apiClient.fetchUsername();

    expect(username).toBe("session-user");
    expect(await Bun.file(paths.sessionFile).exists()).toBe(false);
  });

  test("auth status falls back to OAuth when stale persisted sessions belong to the same account", async () => {
    seedOAuth("session-user");
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === `${REDDIT_BASE_URL}/api/me.json`) {
        return new Response("unauthorized", { status: 401 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const res = await authRoute.fetch(new Request("http://localhost/status", { method: "GET" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      authenticated: true,
      username: "session-user",
      mode: "oauth",
      testMode: false,
    });
    expect(await Bun.file(paths.sessionFile).exists()).toBe(false);
  });

  test("does not fall back to OAuth when stale persisted sessions belong to another account", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === `${REDDIT_BASE_URL}/api/me.json`) {
        return new Response("unauthorized", { status: 401 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const ctx = getAppContext();

    await expect(ctx.apiClient.fetchUsername()).rejects.toThrow(
      "Session verification failed: HTTP 401",
    );
    expect(await Bun.file(paths.sessionFile).exists()).toBe(false);
    expect(await Bun.file(paths.authFile).exists()).toBe(true);
  });

  test("auth status reports stale persisted sessions as unauthenticated when OAuth belongs to another account", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === `${REDDIT_BASE_URL}/api/me.json`) {
        return new Response("unauthorized", { status: 401 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const res = await authRoute.fetch(new Request("http://localhost/status", { method: "GET" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      authenticated: false,
      username: null,
      mode: null,
      error: "Session verification failed: HTTP 401",
      testMode: false,
    });
    expect(await Bun.file(paths.sessionFile).exists()).toBe(false);
    expect(await Bun.file(paths.authFile).exists()).toBe(true);
  });

  test("falls back to OAuth when a transient session failure affects the same account", async () => {
    seedOAuth("session-user");
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === `${REDDIT_BASE_URL}/api/me.json`) {
        return new Response("unavailable", { status: 503 });
      }
      if (url === `${REDDIT_OAUTH_BASE_URL}/api/v1/me`) {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer oauth-access");
        return Response.json({ name: "session-user" });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const ctx = getAppContext();
    const username = await ctx.apiClient.fetchUsername();

    expect(username).toBe("session-user");
    expect(await Bun.file(paths.sessionFile).exists()).toBe(true);
  });

  test("auth status falls back to OAuth on transient failures for the same account", async () => {
    seedOAuth("session-user");
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === `${REDDIT_BASE_URL}/api/me.json`) {
        return new Response("unavailable", { status: 503 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const res = await authRoute.fetch(new Request("http://localhost/status", { method: "GET" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      authenticated: true,
      username: "session-user",
      mode: "oauth",
      testMode: false,
    });
    expect(await Bun.file(paths.sessionFile).exists()).toBe(true);
  });

  test("surfaces transient session verification failures when OAuth is unavailable", async () => {
    rmSync(paths.authFile, { force: true });
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === `${REDDIT_BASE_URL}/api/me.json`) {
        return new Response("unavailable", { status: 503 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const ctx = getAppContext();

    await expect(ctx.apiClient.fetchUsername()).rejects.toThrow(
      "Session verification failed: HTTP 503",
    );
    expect(await Bun.file(paths.sessionFile).exists()).toBe(true);
  });

  test("does not fall back to OAuth when a transient session failure would switch accounts", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === `${REDDIT_BASE_URL}/api/me.json`) {
        return new Response("unavailable", { status: 503 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const ctx = getAppContext();

    await expect(ctx.apiClient.fetchUsername()).rejects.toThrow(
      "Session verification failed: HTTP 503",
    );
    expect(await Bun.file(paths.sessionFile).exists()).toBe(true);
  });

  test("auth status surfaces transient session failures when OAuth belongs to another account", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === `${REDDIT_BASE_URL}/api/me.json`) {
        return new Response("unavailable", { status: 503 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const res = await authRoute.fetch(new Request("http://localhost/status", { method: "GET" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      authenticated: false,
      username: null,
      mode: null,
      error: "Session verification failed: HTTP 503",
      testMode: false,
    });
    expect(await Bun.file(paths.sessionFile).exists()).toBe(true);
  });

  test("pinned sync auth keeps using OAuth for every page after a same-account transient session failure", async () => {
    seedOAuth("session-user");
    let sessionChecks = 0;
    const requestedUrls: string[] = [];

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      requestedUrls.push(url);
      if (url === `${REDDIT_BASE_URL}/api/me.json`) {
        sessionChecks += 1;
        if (sessionChecks === 1) {
          return new Response("unavailable", { status: 503 });
        }
        return Response.json({ kind: "t2", data: { name: "session-user" } });
      }
      if (url === `${REDDIT_OAUTH_BASE_URL}/user/session-user/saved?limit=100`) {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer oauth-access");
        return Response.json({
          kind: "Listing",
          data: {
            children: [{ kind: "t3", data: { id: "oauth-page-1", name: "t3_oauth-page-1" } }],
            after: "cursor_oauth_1",
          },
        });
      }
      if (
        url === `${REDDIT_OAUTH_BASE_URL}/user/session-user/saved?limit=100&after=cursor_oauth_1`
      ) {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer oauth-access");
        return Response.json({
          kind: "Listing",
          data: {
            children: [{ kind: "t3", data: { id: "oauth-page-2", name: "t3_oauth-page-2" } }],
            after: null,
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const ctx = getAppContext();
    const syncClient = new RedditApiClient(
      await ctx.authProvider.createPinnedProvider(),
      ctx.queue,
    );

    const result = await syncClient.fetchSaved();

    expect(result.items.map((item) => item.data.id)).toEqual(["oauth-page-1", "oauth-page-2"]);
    expect(sessionChecks).toBe(1);
    expect(
      requestedUrls.filter((url) =>
        url.startsWith(`${REDDIT_BASE_URL}/user/session-user/saved.json`),
      ),
    ).toHaveLength(0);
    expect(
      requestedUrls.filter((url) =>
        url.startsWith(`${REDDIT_OAUTH_BASE_URL}/user/session-user/saved`),
      ),
    ).toHaveLength(2);
  });

  test("pinned sync auth can fall back to OAuth mid-sync after starting in session mode", async () => {
    seedOAuth("session-user");
    let now = 1_000;
    Date.now = () => now;

    let sessionChecks = 0;
    const requestedUrls: string[] = [];

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      requestedUrls.push(url);

      if (url === `${REDDIT_BASE_URL}/api/me.json`) {
        sessionChecks += 1;
        if (sessionChecks === 1) {
          return Response.json({ kind: "t2", data: { name: "session-user", modhash: "modhash" } });
        }
        return new Response("unavailable", { status: 503 });
      }

      if (url === `${REDDIT_BASE_URL}/user/session-user/saved.json?limit=100`) {
        now = 62_000;
        return Response.json({
          kind: "Listing",
          data: {
            children: [{ kind: "t3", data: { id: "session-page-1", name: "t3_session-page-1" } }],
            after: "cursor_session_1",
          },
        });
      }

      if (
        url === `${REDDIT_OAUTH_BASE_URL}/user/session-user/saved?limit=100&after=cursor_session_1`
      ) {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer oauth-access");
        return Response.json({
          kind: "Listing",
          data: {
            children: [{ kind: "t3", data: { id: "oauth-page-2", name: "t3_oauth-page-2" } }],
            after: null,
          },
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const ctx = getAppContext();
    const syncClient = new RedditApiClient(
      await ctx.authProvider.createPinnedProvider(),
      ctx.queue,
    );

    const result = await syncClient.fetchSaved();

    expect(result.items.map((item) => item.data.id)).toEqual(["session-page-1", "oauth-page-2"]);
    expect(result.wasErrored).toBeUndefined();
    expect(sessionChecks).toBe(2);
    expect(
      requestedUrls.filter((url) =>
        url.startsWith(`${REDDIT_BASE_URL}/user/session-user/saved.json`),
      ),
    ).toHaveLength(1);
    expect(
      requestedUrls.filter((url) =>
        url.startsWith(`${REDDIT_OAUTH_BASE_URL}/user/session-user/saved`),
      ),
    ).toHaveLength(1);
  });

  test("pinned sync auth refuses to switch accounts after a transient session failure", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === `${REDDIT_BASE_URL}/api/me.json`) {
        return new Response("unavailable", { status: 503 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const ctx = getAppContext();

    await expect(ctx.authProvider.createPinnedProvider()).rejects.toThrow(
      "Session verification failed: HTTP 503",
    );
  });

  test("session status clears stale persisted sessions before reporting connected", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === `${REDDIT_BASE_URL}/api/me.json`) {
        return new Response("unauthorized", { status: 401 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const res = await authRoute.fetch(new Request("http://localhost/session", { method: "GET" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ connected: false, blocked: false });
    expect(await Bun.file(paths.sessionFile).exists()).toBe(false);
  });

  test("disconnect blocks extension heartbeats until reconnect is explicitly allowed", async () => {
    const disconnectRes = await authRoute.fetch(
      new Request("http://localhost/session", { method: "DELETE" }),
    );
    expect(disconnectRes.status).toBe(200);
    expect(await disconnectRes.json()).toEqual({ ok: true });
    expect(await Bun.file(paths.sessionFile).exists()).toBe(false);
    expect(await Bun.file(paths.sessionBlockFile).exists()).toBe(true);

    const blockedRes = await authRoute.fetch(
      new Request("http://localhost/session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "chrome-extension://test-extension",
        },
        body: JSON.stringify({
          cookies: [
            {
              name: "reddit_session",
              value: "fresh",
              domain: ".reddit.com",
              path: "/",
              expirationDate: null,
            },
          ],
          cookieHeader: "reddit_session=fresh",
          userAgent: "unit-test-agent",
          capturedAt: 2,
        }),
      }),
    );

    expect(blockedRes.status).toBe(409);
    expect(await blockedRes.json()).toEqual({
      ok: false,
      code: "SESSION_BLOCKED",
      message: "Extension session sync is disabled until you reconnect from the app.",
    });
    expect(await Bun.file(paths.sessionFile).exists()).toBe(false);

    const statusRes = await authRoute.fetch(
      new Request("http://localhost/session", { method: "GET" }),
    );
    expect(statusRes.status).toBe(200);
    expect(await statusRes.json()).toEqual({ connected: false, blocked: true });

    const reconnectRes = await authRoute.fetch(
      new Request("http://localhost/session/reconnect", {
        method: "POST",
        headers: { origin: "chrome-extension://test-extension" },
      }),
    );
    expect(reconnectRes.status).toBe(200);
    expect(await reconnectRes.json()).toEqual({ ok: true });

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === `${REDDIT_BASE_URL}/api/me.json`) {
        const headers = new Headers(init?.headers);
        expect(headers.get("cookie")).toBe("reddit_session=fresh");
        expect(headers.get("user-agent")).toBe("unit-test-agent");
        return Response.json({
          data: {
            name: "session-user",
            modhash: "fresh-modhash",
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const connectedRes = await authRoute.fetch(
      new Request("http://localhost/session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "chrome-extension://test-extension",
        },
        body: JSON.stringify({
          cookies: [
            {
              name: "reddit_session",
              value: "fresh",
              domain: ".reddit.com",
              path: "/",
              expirationDate: null,
            },
          ],
          cookieHeader: "reddit_session=fresh",
          userAgent: "unit-test-agent",
          capturedAt: 2,
        }),
      }),
    );
    expect(connectedRes.status).toBe(200);
    expect(await connectedRes.json()).toEqual({
      ok: true,
      username: "session-user",
      capturedAt: 2,
    });
    expect(await Bun.file(paths.sessionBlockFile).exists()).toBe(false);
  });

  test("session reconnect allows localhost origins", async () => {
    await authRoute.fetch(new Request("http://localhost/session", { method: "DELETE" }));

    const reconnectRes = await authRoute.fetch(
      new Request("http://localhost/session/reconnect", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      }),
    );

    expect(reconnectRes.status).toBe(200);
    expect(await reconnectRes.json()).toEqual({ ok: true });
    expect(await Bun.file(paths.sessionBlockFile).exists()).toBe(false);
  });

  test("session reconnect rejects foreign web origins", async () => {
    await authRoute.fetch(new Request("http://localhost/session", { method: "DELETE" }));

    const reconnectRes = await authRoute.fetch(
      new Request("http://localhost/session/reconnect", {
        method: "POST",
        headers: { origin: "https://evil.example" },
      }),
    );

    expect(reconnectRes.status).toBe(403);
    expect(await reconnectRes.text()).toContain("Origin not permitted: https://evil.example");
    expect(await Bun.file(paths.sessionBlockFile).exists()).toBe(true);
  });

  test("extension clear removes the session without entering blocked mode", async () => {
    const clearRes = await authRoute.fetch(
      new Request("http://localhost/session/clear", {
        method: "POST",
        headers: {
          origin: "chrome-extension://test-extension",
        },
      }),
    );
    expect(clearRes.status).toBe(200);
    expect(await clearRes.json()).toEqual({ ok: true });
    expect(await Bun.file(paths.sessionFile).exists()).toBe(false);
    expect(await Bun.file(paths.sessionBlockFile).exists()).toBe(false);

    const statusRes = await authRoute.fetch(
      new Request("http://localhost/session", { method: "GET" }),
    );
    expect(statusRes.status).toBe(200);
    expect(await statusRes.json()).toEqual({ connected: false, blocked: false });

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === `${REDDIT_BASE_URL}/api/me.json`) {
        const headers = new Headers(init?.headers);
        expect(headers.get("cookie")).toBe("reddit_session=fresh");
        expect(headers.get("user-agent")).toBe("unit-test-agent");
        return Response.json({
          data: {
            name: "session-user",
            modhash: "fresh-modhash",
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const reconnectRes = await authRoute.fetch(
      new Request("http://localhost/session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "chrome-extension://test-extension",
        },
        body: JSON.stringify({
          cookies: [
            {
              name: "reddit_session",
              value: "fresh",
              domain: ".reddit.com",
              path: "/",
              expirationDate: null,
            },
          ],
          cookieHeader: "reddit_session=fresh",
          userAgent: "unit-test-agent",
          capturedAt: 2,
        }),
      }),
    );

    expect(reconnectRes.status).toBe(200);
    expect(await reconnectRes.json()).toEqual({
      ok: true,
      username: "session-user",
      capturedAt: 2,
    });
    expect(await Bun.file(paths.sessionBlockFile).exists()).toBe(false);
  });

  test("session ingest derives username and modhash from the submitted cookie header", async () => {
    rmSync(paths.sessionFile, { force: true });
    const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === `${REDDIT_BASE_URL}/api/me.json`) {
        const headers = new Headers(init?.headers);
        expect(headers.get("cookie")).toBe("reddit_session=fresh");
        expect(headers.get("user-agent")).toBe("unit-test-agent");
        return Response.json({
          data: {
            name: "session-user",
            modhash: "fresh-modhash",
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const res = await authRoute.fetch(
      new Request("http://localhost/session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "chrome-extension://test-extension",
        },
        body: JSON.stringify({
          cookies: [
            {
              name: "reddit_session",
              value: "fresh",
              domain: ".reddit.com",
              path: "/",
              expirationDate: null,
            },
          ],
          cookieHeader: "reddit_session=fresh",
          userAgent: "unit-test-agent",
          capturedAt: 2,
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      username: "session-user",
      capturedAt: 2,
    });
    await expect(Bun.file(paths.sessionFile).json()).resolves.toMatchObject({
      cookieHeader: "reddit_session=fresh",
      userAgent: "unit-test-agent",
      username: "session-user",
      modhash: "fresh-modhash",
      capturedAt: 2,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("session ingest rejects cookie headers that reddit no longer accepts", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === `${REDDIT_BASE_URL}/api/me.json`) {
        return new Response("unauthorized", { status: 401 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const res = await authRoute.fetch(
      new Request("http://localhost/session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "chrome-extension://test-extension",
        },
        body: JSON.stringify({
          cookies: [
            {
              name: "reddit_session",
              value: "expired",
              domain: ".reddit.com",
              path: "/",
              expirationDate: null,
            },
          ],
          cookieHeader: "reddit_session=expired",
          userAgent: "unit-test-agent",
          capturedAt: 2,
        }),
      }),
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      ok: false,
      code: "SESSION_INVALID",
      message: "Session verification failed: HTTP 401",
    });
  });

  test("login allows localhost origins", async () => {
    process.env.TEST_MODE = "1";

    const loginRes = await authRoute.fetch(makeLoginRequest("http://localhost:3000"));

    expect(loginRes.status).toBe(200);
    expect(await loginRes.json()).toEqual({ started: true, authorizeUrl: null, testMode: true });
  });

  test("login allows empty-Origin requests from the local app referer", async () => {
    process.env.TEST_MODE = "1";

    const loginRes = await authRoute.fetch(makeLoginRequest(null, "http://localhost:3000/login"));

    expect(loginRes.status).toBe(200);
    expect(await loginRes.json()).toEqual({ started: true, authorizeUrl: null, testMode: true });
  });

  test("login allows extension origins", async () => {
    process.env.TEST_MODE = "1";

    const loginRes = await authRoute.fetch(makeLoginRequest("chrome-extension://test-extension"));

    expect(loginRes.status).toBe(200);
    expect(await loginRes.json()).toEqual({ started: true, authorizeUrl: null, testMode: true });
  });

  test("login rejects foreign web origins before starting OAuth", async () => {
    process.env.TEST_MODE = "1";

    const loginRes = await authRoute.fetch(makeLoginRequest("https://evil.example"));

    expect(loginRes.status).toBe(403);
    expect(await loginRes.text()).toContain("Origin not permitted: https://evil.example");
    expect(await Bun.file(paths.sessionFile).exists()).toBe(true);
    expect(await Bun.file(paths.authFile).exists()).toBe(true);
  });

  test("login rejects empty-Origin requests with a foreign Referer", async () => {
    process.env.TEST_MODE = "1";

    const loginRes = await authRoute.fetch(makeLoginRequest(null, "https://evil.example/login"));

    expect(loginRes.status).toBe(403);
    expect(await loginRes.text()).toContain("Origin not permitted: https://evil.example/login");
    expect(await Bun.file(paths.sessionFile).exists()).toBe(true);
    expect(await Bun.file(paths.authFile).exists()).toBe(true);
  });

  test("generic logout clears session auth and blocks extension reconnects", async () => {
    rmSync(paths.authFile, { force: true });

    const logoutRes = await authRoute.fetch(
      new Request("http://localhost/logout", { method: "POST" }),
    );

    expect(logoutRes.status).toBe(200);
    expect(await logoutRes.json()).toEqual({ ok: true });
    expect(await Bun.file(paths.sessionFile).exists()).toBe(false);
    expect(await Bun.file(paths.authFile).exists()).toBe(false);
    expect(await Bun.file(paths.sessionBlockFile).exists()).toBe(true);

    const sessionRes = await authRoute.fetch(
      new Request("http://localhost/session", { method: "GET" }),
    );
    expect(sessionRes.status).toBe(200);
    expect(await sessionRes.json()).toEqual({ connected: false, blocked: true });

    const statusRes = await authRoute.fetch(
      new Request("http://localhost/status", { method: "GET" }),
    );
    expect(statusRes.status).toBe(200);
    expect(await statusRes.json()).toEqual({
      authenticated: false,
      username: null,
      mode: null,
      testMode: false,
    });
  });

  test("generic logout allows localhost origins", async () => {
    const logoutRes = await authRoute.fetch(
      new Request("http://localhost/logout", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      }),
    );

    expect(logoutRes.status).toBe(200);
    expect(await logoutRes.json()).toEqual({ ok: true });
    expect(await Bun.file(paths.sessionFile).exists()).toBe(false);
    expect(await Bun.file(paths.authFile).exists()).toBe(false);
    expect(await Bun.file(paths.sessionBlockFile).exists()).toBe(true);
  });

  test("generic logout allows empty-Origin requests from the local app referer", async () => {
    const logoutRes = await authRoute.fetch(
      new Request("http://localhost/logout", {
        method: "POST",
        headers: { referer: "http://localhost:3000/settings" },
      }),
    );

    expect(logoutRes.status).toBe(200);
    expect(await logoutRes.json()).toEqual({ ok: true });
    expect(await Bun.file(paths.sessionFile).exists()).toBe(false);
    expect(await Bun.file(paths.authFile).exists()).toBe(false);
    expect(await Bun.file(paths.sessionBlockFile).exists()).toBe(true);
  });

  test("generic logout allows extension origins", async () => {
    const logoutRes = await authRoute.fetch(
      new Request("http://localhost/logout", {
        method: "POST",
        headers: { origin: "chrome-extension://test-extension" },
      }),
    );

    expect(logoutRes.status).toBe(200);
    expect(await logoutRes.json()).toEqual({ ok: true });
    expect(await Bun.file(paths.sessionFile).exists()).toBe(false);
    expect(await Bun.file(paths.authFile).exists()).toBe(false);
    expect(await Bun.file(paths.sessionBlockFile).exists()).toBe(true);
  });

  test("generic logout rejects foreign web origins without clearing auth", async () => {
    const logoutRes = await authRoute.fetch(
      new Request("http://localhost/logout", {
        method: "POST",
        headers: { origin: "https://evil.example" },
      }),
    );

    expect(logoutRes.status).toBe(403);
    expect(await logoutRes.text()).toContain("Origin not permitted: https://evil.example");
    expect(await Bun.file(paths.sessionFile).exists()).toBe(true);
    expect(await Bun.file(paths.authFile).exists()).toBe(true);
    expect(await Bun.file(paths.sessionBlockFile).exists()).toBe(false);
  });

  test("generic logout rejects empty-Origin requests with a foreign Referer", async () => {
    const logoutRes = await authRoute.fetch(
      new Request("http://localhost/logout", {
        method: "POST",
        headers: { referer: "https://evil.example/account" },
      }),
    );

    expect(logoutRes.status).toBe(403);
    expect(await logoutRes.text()).toContain("Origin not permitted: https://evil.example/account");
    expect(await Bun.file(paths.sessionFile).exists()).toBe(true);
    expect(await Bun.file(paths.authFile).exists()).toBe(true);
    expect(await Bun.file(paths.sessionBlockFile).exists()).toBe(false);
  });

  test("generic logout clears both session and OAuth auth", async () => {
    const logoutRes = await authRoute.fetch(
      new Request("http://localhost/logout", { method: "POST" }),
    );

    expect(logoutRes.status).toBe(200);
    expect(await logoutRes.json()).toEqual({ ok: true });
    expect(await Bun.file(paths.sessionFile).exists()).toBe(false);
    expect(await Bun.file(paths.authFile).exists()).toBe(false);
    expect(await Bun.file(paths.sessionBlockFile).exists()).toBe(true);

    const statusRes = await authRoute.fetch(
      new Request("http://localhost/status", { method: "GET" }),
    );
    expect(statusRes.status).toBe(200);
    expect(await statusRes.json()).toEqual({
      authenticated: false,
      username: null,
      mode: null,
      testMode: false,
    });
  });

  test("auth status reuses the session verification cache across repeated requests", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === `${REDDIT_BASE_URL}/api/me.json`) {
        return Response.json({
          data: {
            name: "session-user",
            modhash: "fresh-modhash",
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const first = await authRoute.fetch(new Request("http://localhost/status", { method: "GET" }));
    const second = await authRoute.fetch(new Request("http://localhost/status", { method: "GET" }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await expect(first.json()).resolves.toEqual({
      authenticated: true,
      username: "session-user",
      mode: "session",
      capturedAt: expect.any(Number),
      testMode: false,
    });
    await expect(second.json()).resolves.toEqual({
      authenticated: true,
      username: "session-user",
      mode: "session",
      capturedAt: expect.any(Number),
      testMode: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("auth status preserves the original extension capture time after verification", async () => {
    Date.now = () => 123_456_789;
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === `${REDDIT_BASE_URL}/api/me.json`) {
        return Response.json({
          data: {
            name: "session-user",
            modhash: "fresh-modhash",
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const res = await authRoute.fetch(new Request("http://localhost/status", { method: "GET" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      authenticated: true,
      username: "session-user",
      mode: "session",
      capturedAt: 1,
      testMode: false,
    });
    await expect(Bun.file(paths.sessionFile).json()).resolves.toMatchObject({
      modhash: "fresh-modhash",
      capturedAt: 1,
    });
  });

  test("auth status reports expired OAuth without a client secret as unauthenticated", async () => {
    process.env.REDDIT_CLIENT_SECRET = undefined;
    rmSync(paths.sessionFile, { force: true });
    writeFileSync(
      paths.authFile,
      JSON.stringify({
        accessToken: "expired-access",
        refreshToken: "oauth-refresh",
        clientId: "client-id",
        tokenExpiry: Date.now() - 1_000,
        username: "oauth-user",
      }),
    );

    const fetchMock = mock(async () => {
      throw new Error("status should not attempt a refresh without a client secret");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const res = await authRoute.fetch(new Request("http://localhost/status", { method: "GET" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      authenticated: false,
      username: null,
      mode: null,
      error:
        "REDDIT_CLIENT_SECRET env var is not set. This is required for token refresh. " +
        "Set the env var and retry, or re-authenticate with 'reddit-saved auth login'.",
      testMode: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
