import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "bun";
import { startOAuthServer } from "../src/auth/oauth-server";

// ---------------------------------------------------------------------------
// Mock Reddit token endpoint — returns fake tokens for any valid request
// ---------------------------------------------------------------------------

let mockReddit: Server<unknown>;
let mockRedditUrl: string;

beforeAll(() => {
  mockReddit = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/api/v1/access_token") {
        const body = await req.text();
        const params = new URLSearchParams(body);

        if (params.get("grant_type") === "authorization_code" && params.get("code")) {
          return Response.json({
            access_token: "mock_access_token",
            refresh_token: "mock_refresh_token",
            expires_in: 3600,
            token_type: "bearer",
            scope: "identity history save",
          });
        }

        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }

      // Mock /api/v1/me for username fetch
      if (url.pathname === "/api/v1/me") {
        return Response.json({ name: "testuser" });
      }

      return new Response("Not found", { status: 404 });
    },
  });
  mockRedditUrl = `http://127.0.0.1:${mockReddit.port}`;
});

afterAll(() => {
  mockReddit.stop(true);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Override the Reddit URLs that token-manager uses by patching constants.
 * Since the oauth-server creates its own TokenManager internally, we need to
 * redirect the fetch calls. We do this by intercepting at the fetch level. */

let originalFetch: typeof globalThis.fetch;
let originalXdgConfig: string | undefined;
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "reddit-saved-oauth-test-"));
  originalFetch = globalThis.fetch;

  // Redirect auth file writes to temp dir so tests never touch real ~/.config.
  // NOTE: XDG_CONFIG_HOME is only used on Linux. On macOS, paths.ts uses
  // ~/Library/Application Support regardless, so this override would not
  // isolate writes on macOS. Tests currently assume Linux.
  originalXdgConfig = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = tempDir;

  // Intercept fetch calls to Reddit OAuth endpoints and redirect to mock.
  // Requests to 127.0.0.1 (the local OAuth callback server) pass through.
  // Any other unexpected URL throws immediately to prevent real network calls.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url.includes("reddit.com/api/v1/access_token")) {
      return originalFetch(`${mockRedditUrl}/api/v1/access_token`, init);
    }
    if (url.includes("oauth.reddit.com/api/v1/me")) {
      return originalFetch(`${mockRedditUrl}/api/v1/me`, init);
    }

    // Allow local requests (OAuth callback server reaching itself)
    if (url.includes("127.0.0.1")) {
      return originalFetch(input, init);
    }

    throw new Error(`Test interceptor: unexpected fetch to ${url}`);
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalXdgConfig === undefined) {
    // biome-ignore lint/performance/noDelete: process.env assignment of undefined coerces to string "undefined"
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = originalXdgConfig;
  }
  rmSync(tempDir, { recursive: true, force: true });
});

// Port counter to avoid TOCTOU races from bind-unbind-rebind.
// Each test gets a unique port offset from a high base.
// NOTE: We can't use port: 0 because the redirect URI must be known before
// the server starts (it's embedded in the PKCE state and authorize URL).
// Use PID-based offset — stable per worker, unique across OS processes.
let nextPort = 19_000 + (process.pid % 10_000);
function allocatePort(): number {
  return nextPort++;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("startOAuthServer", () => {
  test("starts and returns authorizeUrl", async () => {
    const port = allocatePort();
    const handle = await startOAuthServer({
      clientId: "test-client",
      clientSecret: "test-secret",
      port,
    });

    expect(handle.authorizeUrl).toContain("reddit.com");
    expect(handle.authorizeUrl).toContain("client_id=test-client");
    expect(handle.authorizeUrl).toContain("code_challenge=");
    expect(handle.authorizeUrl).toContain("code_challenge_method=S256");

    handle.done.catch(() => {}); // suppress unhandled rejection
    handle.stop();
  });

  test("rejects invalid returnTo URL (bad protocol)", async () => {
    const port = allocatePort();
    await expect(
      startOAuthServer({
        clientId: "test-client",
        clientSecret: "test-secret",
        port,
        returnTo: "ftp://localhost:3001",
      }),
    ).rejects.toThrow("http or https");
  });

  test("rejects invalid returnTo URL (disallowed hostname)", async () => {
    const port = allocatePort();
    await expect(
      startOAuthServer({
        clientId: "test-client",
        clientSecret: "test-secret",
        port,
        returnTo: "http://evil.com/steal",
      }),
    ).rejects.toThrow("not in the allowed set");
  });

  test("callback with valid code+state exchanges token", async () => {
    const port = allocatePort();
    let successUsername = "";
    const handle = await startOAuthServer({
      clientId: "test-client",
      clientSecret: "test-secret",
      port,
      onSuccess: (username) => {
        successUsername = username;
      },
    });

    // Extract state from the authorize URL
    const authUrl = new URL(handle.authorizeUrl);
    const state = authUrl.searchParams.get("state") ?? "";

    // Simulate Reddit redirecting to our callback
    const response = await fetch(
      `http://127.0.0.1:${port}/callback?code=mock_auth_code&state=${state}`,
    );
    expect(response.status).toBe(200);

    await handle.done;
    expect(successUsername).toBe("testuser");
  });

  test("callback with error param rejects done", async () => {
    const port = allocatePort();
    let errorMessage = "";
    const handle = await startOAuthServer({
      clientId: "test-client",
      clientSecret: "test-secret",
      port,
      onError: (err) => {
        errorMessage = err.message;
      },
    });

    // Attach catch handler before triggering error to prevent unhandled rejection
    const donePromise = handle.done.catch((err: Error) => err);

    const authUrl = new URL(handle.authorizeUrl);
    const state = authUrl.searchParams.get("state") ?? "";

    const response = await fetch(
      `http://127.0.0.1:${port}/callback?error=access_denied&state=${state}`,
    );
    // Server returns 200 even for OAuth errors — it renders an HTML error page
    // to the user's browser. The actual error is communicated via the done promise.
    expect(response.status).toBe(200);

    const result = await donePromise;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain("access_denied");
    expect(errorMessage).toContain("access_denied");
  });

  test("callback with missing code returns 400", async () => {
    const port = allocatePort();
    const handle = await startOAuthServer({
      clientId: "test-client",
      clientSecret: "test-secret",
      port,
    });

    const response = await fetch(`http://127.0.0.1:${port}/callback?state=something`);
    expect(response.status).toBe(400);

    handle.done.catch(() => {});
    handle.stop();
  });

  test("callback with invalid state returns 400", async () => {
    const port = allocatePort();
    const handle = await startOAuthServer({
      clientId: "test-client",
      clientSecret: "test-secret",
      port,
    });

    const response = await fetch(`http://127.0.0.1:${port}/callback?code=abc&state=invalid_state`);
    expect(response.status).toBe(400);

    handle.done.catch(() => {});
    handle.stop();
  });

  test("non-callback paths return 404", async () => {
    const port = allocatePort();
    const handle = await startOAuthServer({
      clientId: "test-client",
      clientSecret: "test-secret",
      port,
    });

    const response = await fetch(`http://127.0.0.1:${port}/other`);
    expect(response.status).toBe(404);

    handle.done.catch(() => {});
    handle.stop();
  });

  test("duplicate callback returns 400 after first is handled", async () => {
    const port = allocatePort();
    const handle = await startOAuthServer({
      clientId: "test-client",
      clientSecret: "test-secret",
      port,
    });

    const authUrl = new URL(handle.authorizeUrl);
    const state = authUrl.searchParams.get("state") ?? "";

    // First callback
    const res1 = await fetch(
      `http://127.0.0.1:${port}/callback?code=mock_auth_code&state=${state}`,
    );
    expect(res1.status).toBe(200);

    await handle.done;

    // Second callback — should get 400 (server stays up briefly after done resolves
    // via a 500ms teardown timer, so it can still respond).
    // Small delay to let teardown start but not finish, narrowing the race window.
    await new Promise((r) => setTimeout(r, 50));
    // Guard against ECONNREFUSED if the teardown timer fires before the fetch completes.
    const res2 = await fetch(
      `http://127.0.0.1:${port}/callback?code=mock_auth_code&state=${state}`,
    ).catch(() => null);
    if (res2 !== null) {
      expect(res2.status).toBe(400);
    }

    handle.stop();
  });

  test("stop cancels the flow", async () => {
    const port = allocatePort();
    const handle = await startOAuthServer({
      clientId: "test-client",
      clientSecret: "test-secret",
      port,
    });

    handle.stop();

    await expect(handle.done).rejects.toThrow("cancelled");
  });

  test("callback with returnTo redirects", async () => {
    const port = allocatePort();
    const handle = await startOAuthServer({
      clientId: "test-client",
      clientSecret: "test-secret",
      port,
      returnTo: "http://127.0.0.1:3001",
    });

    const authUrl = new URL(handle.authorizeUrl);
    const state = authUrl.searchParams.get("state") ?? "";

    const response = await fetch(
      `http://127.0.0.1:${port}/callback?code=mock_auth_code&state=${state}`,
      {
        redirect: "manual",
      },
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://127.0.0.1:3001");

    await handle.done;
  });
});
