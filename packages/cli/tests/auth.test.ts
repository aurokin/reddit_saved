import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setOutputMode } from "../src/output";
import { ExitCaptured, captureConsole, captureExit, makeTempDb, restoreFetch } from "./helpers";

const originalEnv = { ...process.env };

function captureBrowserSpawn(): {
  calls: Array<Parameters<typeof Bun.spawn>>;
  restore: () => void;
} {
  const calls: Array<Parameters<typeof Bun.spawn>> = [];
  const originalSpawn = Bun.spawn;
  Bun.spawn = ((...args: Parameters<typeof Bun.spawn>) => {
    calls.push(args);
    return {} as ReturnType<typeof Bun.spawn>;
  }) as typeof Bun.spawn;
  return {
    calls,
    restore: () => {
      Bun.spawn = originalSpawn;
    },
  };
}

describe("auth status", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `cli-auth-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    process.env.REDDIT_SAVED_CONFIG_DIR = join(tempDir, "reddit-saved");
    setOutputMode(false, false, false);
  });

  afterEach(() => {
    setOutputMode(false, false, false);
    process.env.REDDIT_SAVED_CONFIG_DIR = originalEnv.REDDIT_SAVED_CONFIG_DIR;
    if (!originalEnv.REDDIT_SAVED_CONFIG_DIR) {
      Reflect.deleteProperty(process.env, "REDDIT_SAVED_CONFIG_DIR");
    }
    if (originalEnv.REDDIT_CLIENT_SECRET !== undefined) {
      process.env.REDDIT_CLIENT_SECRET = originalEnv.REDDIT_CLIENT_SECRET;
    } else {
      process.env.REDDIT_CLIENT_SECRET = undefined;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("shows not authenticated when no auth.json", async () => {
    const { authStatus } = await import("../src/auth/status");
    const cap = captureConsole();
    try {
      await authStatus();
      const output = JSON.parse(cap.logs[0]);
      expect(output.authenticated).toBe(false);
    } finally {
      cap.restore();
    }
  });

  test("shows authenticated with token info", async () => {
    const configDir = join(tempDir, "reddit-saved");
    mkdirSync(configDir, { recursive: true });
    const expiry = Date.now() + 3600_000;
    writeFileSync(
      join(configDir, "auth.json"),
      JSON.stringify({
        accessToken: "test-token",
        refreshToken: "test-refresh",
        tokenExpiry: expiry,
        username: "testuser",
        clientId: "test-client-id",
      }),
    );
    process.env.REDDIT_CLIENT_SECRET = "test-secret";

    const { authStatus } = await import("../src/auth/status");
    const cap = captureConsole();
    try {
      await authStatus();
      const output = JSON.parse(cap.logs[0]);
      expect(output.authenticated).toBe(true);
      expect(output.username).toBe("testuser");
      expect(output.tokenExpired).toBe(false);
      expect(output.tokenExpiresIn).toBeGreaterThan(0);
    } finally {
      cap.restore();
    }
  });

  test("shows expired token status", async () => {
    const configDir = join(tempDir, "reddit-saved");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "auth.json"),
      JSON.stringify({
        accessToken: "test-token",
        refreshToken: "test-refresh",
        tokenExpiry: Date.now() - 1000, // expired
        username: "expireduser",
        clientId: "test-client-id",
      }),
    );
    process.env.REDDIT_CLIENT_SECRET = "test-secret";

    const { authStatus } = await import("../src/auth/status");
    const cap = captureConsole();
    try {
      await authStatus();
      const output = JSON.parse(cap.logs[0]);
      expect(output.authenticated).toBe(true);
      expect(output.tokenExpired).toBe(true);
      expect(output.tokenExpiresIn).toBe(0);
    } finally {
      cap.restore();
    }
  });

  test("shows authenticated status even when REDDIT_CLIENT_SECRET is unset", async () => {
    const configDir = join(tempDir, "reddit-saved");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "auth.json"),
      JSON.stringify({
        accessToken: "test-token",
        refreshToken: "test-refresh",
        tokenExpiry: Date.now() + 3600_000,
        username: "nosecretuser",
        clientId: "test-client-id",
      }),
    );
    process.env.REDDIT_CLIENT_SECRET = undefined;

    const { authStatus } = await import("../src/auth/status");
    const cap = captureConsole();
    try {
      await authStatus({}, []);
      const output = JSON.parse(cap.logs[0]);
      expect(output.authenticated).toBe(true);
      expect(output.username).toBe("nosecretuser");
    } finally {
      cap.restore();
    }
  });
});

describe("auth logout", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `cli-auth-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    process.env.REDDIT_SAVED_CONFIG_DIR = join(tempDir, "reddit-saved");
    setOutputMode(false, false, false);
  });

  afterEach(() => {
    setOutputMode(false, false, false);
    process.env.REDDIT_SAVED_CONFIG_DIR = originalEnv.REDDIT_SAVED_CONFIG_DIR;
    if (!originalEnv.REDDIT_SAVED_CONFIG_DIR) {
      Reflect.deleteProperty(process.env, "REDDIT_SAVED_CONFIG_DIR");
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("outputs loggedOut: true", async () => {
    const { authLogout } = await import("../src/auth/logout");
    const cap = captureConsole();
    try {
      await authLogout();
      const output = JSON.parse(cap.logs[0]);
      expect(output.loggedOut).toBe(true);
    } finally {
      cap.restore();
    }
  });
});

describe("auth login", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `cli-auth-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    process.env.REDDIT_SAVED_CONFIG_DIR = join(tempDir, "reddit-saved");
    setOutputMode(false, false, false);
  });

  afterEach(() => {
    setOutputMode(false, false, false);
    process.env.REDDIT_SAVED_CONFIG_DIR = originalEnv.REDDIT_SAVED_CONFIG_DIR;
    if (!originalEnv.REDDIT_SAVED_CONFIG_DIR) {
      Reflect.deleteProperty(process.env, "REDDIT_SAVED_CONFIG_DIR");
    }
    if (originalEnv.REDDIT_SAVED_OPEN_BROWSER !== undefined) {
      process.env.REDDIT_SAVED_OPEN_BROWSER = originalEnv.REDDIT_SAVED_OPEN_BROWSER;
    } else {
      Reflect.deleteProperty(process.env, "REDDIT_SAVED_OPEN_BROWSER");
    }
    // Clean up env vars that might have been set
    process.env.REDDIT_CLIENT_ID = undefined;
    process.env.REDDIT_CLIENT_SECRET = undefined;
    if (originalEnv.REDDIT_CLIENT_ID) process.env.REDDIT_CLIENT_ID = originalEnv.REDDIT_CLIENT_ID;
    if (originalEnv.REDDIT_CLIENT_SECRET)
      process.env.REDDIT_CLIENT_SECRET = originalEnv.REDDIT_CLIENT_SECRET;
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("exits with error when client ID missing", async () => {
    process.env.REDDIT_CLIENT_ID = undefined;
    process.env.REDDIT_CLIENT_SECRET = undefined;

    const { authLogin } = await import("../src/auth/login");
    const cap = captureConsole();
    const exit = captureExit();
    try {
      await authLogin({});
    } catch (e) {
      expect(e).toBeInstanceOf(ExitCaptured);
    } finally {
      exit.restore();
      cap.restore();
    }
    expect(exit.exitCode).toBe(1);
    expect(cap.errors[0]).toContain("client ID");
  });

  test("exits with error when client secret missing", async () => {
    process.env.REDDIT_CLIENT_ID = "test-id";
    process.env.REDDIT_CLIENT_SECRET = undefined;

    const { authLogin } = await import("../src/auth/login");
    const cap = captureConsole();
    const exit = captureExit();
    try {
      await authLogin({});
    } catch (e) {
      expect(e).toBeInstanceOf(ExitCaptured);
    } finally {
      exit.restore();
      cap.restore();
    }
    expect(exit.exitCode).toBe(1);
    expect(cap.errors[0]).toContain("client secret");
  });

  test("exits with a clear error when the OAuth callback port is already in use", async () => {
    process.env.REDDIT_CLIENT_ID = "test-id";
    process.env.REDDIT_CLIENT_SECRET = "test-secret";

    const occupiedServer = Bun.serve({
      port: 9638,
      hostname: "127.0.0.1",
      fetch() {
        return new Response("busy");
      },
    });

    const { authLogin } = await import("../src/auth/login");
    const cap = captureConsole();
    const exit = captureExit();
    try {
      await authLogin({});
    } catch (e) {
      expect(e).toBeInstanceOf(ExitCaptured);
    } finally {
      occupiedServer.stop(true);
      exit.restore();
      cap.restore();
    }

    expect(exit.exitCode).toBe(1);
    expect(cap.errors.some((e) => e.includes("OAuth callback port 9638 is already in use"))).toBe(
      true,
    );
  });

  test("happy path: full OAuth login flow", async () => {
    process.env.REDDIT_CLIENT_ID = "test-client-id";
    process.env.REDDIT_CLIENT_SECRET = "test-client-secret";

    // Save the real fetch — we need it for the localhost callback
    const realFetch = globalThis.fetch;

    // Mock fetch for Reddit API calls only (token exchange and /api/v1/me)
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      // Token exchange
      if (url.includes("/api/v1/access_token")) {
        return Response.json({
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
          expires_in: 3600,
          token_type: "bearer",
        });
      }

      // Username fetch
      if (url.includes("/api/v1/me")) {
        return Response.json({ name: "oauth_testuser" });
      }

      // Localhost callback — use real fetch
      if (url.includes("127.0.0.1") || url.includes("localhost")) {
        return realFetch(input, init);
      }

      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    // Use startOAuthServer directly so we can control the port
    const { startOAuthServer } = await import("@reddit-saved/core");

    // Use a random high port to avoid conflict
    const port = 19638 + Math.floor(Math.random() * 1000);
    let capturedUsername = "";

    const handle = await startOAuthServer({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      port,
      onSuccess: (username) => {
        capturedUsername = username;
      },
    });

    // Extract the state from the authorize URL
    expect(handle.authorizeUrl).toContain("reddit.com/api/v1/authorize");
    const stateMatch = handle.authorizeUrl.match(/state=([^&]+)/);
    expect(stateMatch).not.toBeNull();
    if (!stateMatch) {
      throw new Error("Authorize URL did not include state");
    }
    const state = stateMatch[1];

    // Simulate the OAuth callback using real fetch to hit the local server
    const callbackUrl = `http://127.0.0.1:${port}/callback?code=test_auth_code&state=${state}`;
    const callbackResp = await realFetch(callbackUrl);
    expect(callbackResp.status).toBe(200);

    // Wait for the OAuth flow to complete
    await handle.done;

    // Verify auth.json was written
    const authJsonPath = join(tempDir, "reddit-saved", "auth.json");
    expect(existsSync(authJsonPath)).toBe(true);
    const authData = JSON.parse(await Bun.file(authJsonPath).text());
    expect(authData.username).toBe("oauth_testuser");
    expect(authData.accessToken).toBe("new-access-token");
    expect(capturedUsername).toBe("oauth_testuser");

    restoreFetch();
  });

  test("authLogin uses --client-id/--client-secret flags and outputs JSON", async () => {
    // Ensure env vars are NOT set — credentials come from flags only
    process.env.REDDIT_CLIENT_ID = undefined;
    process.env.REDDIT_CLIENT_SECRET = undefined;

    const realFetch = globalThis.fetch;
    const spawn = captureBrowserSpawn();

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("/api/v1/access_token")) {
        return Response.json({
          access_token: "flag-access-token",
          refresh_token: "flag-refresh-token",
          expires_in: 3600,
          token_type: "bearer",
        });
      }
      if (url.includes("/api/v1/me")) {
        return Response.json({ name: "flaguser" });
      }
      if (url.includes("127.0.0.1") || url.includes("localhost")) {
        return realFetch(input, init);
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const { authLogin } = await import("../src/auth/login");
    const cap = captureConsole();

    // Start authLogin as a non-awaited promise — it will block on handle.done
    const loginPromise = authLogin(
      {
        "client-id": "flag-client-id",
        "client-secret": "flag-client-secret",
        port: String(20_000 + Math.floor(Math.random() * 1000)),
      },
      [],
    );

    // Wait for the onAuthorizeUrl callback to print the URL to stderr
    const maxWait = 5000;
    const start = Date.now();
    let authorizeUrl = "";
    while (Date.now() - start < maxWait) {
      const urlLine = cap.errors.find((e) => e.includes("reddit.com/api/v1/authorize"));
      if (urlLine) {
        const match = urlLine.match(/https?:\/\/\S+/);
        if (match) {
          authorizeUrl = match[0];
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(authorizeUrl).toContain("reddit.com/api/v1/authorize");

    // Extract port and state from the authorize URL
    const stateMatch = authorizeUrl.match(/state=([^&]+)/);
    expect(stateMatch).not.toBeNull();
    if (!stateMatch) {
      throw new Error("Authorize URL did not include state");
    }
    const state = stateMatch[1];

    // The redirect URI in the authorize URL tells us the port
    const redirectMatch = authorizeUrl.match(/redirect_uri=([^&]+)/);
    expect(redirectMatch).not.toBeNull();
    if (!redirectMatch) {
      throw new Error("Authorize URL did not include redirect_uri");
    }
    const redirectUri = decodeURIComponent(redirectMatch[1]);
    const portMatch = redirectUri.match(/:(\d+)\//);
    expect(portMatch).not.toBeNull();
    if (!portMatch) {
      throw new Error("redirect_uri did not include a port");
    }
    const port = portMatch[1];

    // Hit the OAuth callback
    const callbackUrl = `http://127.0.0.1:${port}/callback?code=test_code&state=${state}`;
    const callbackResp = await realFetch(callbackUrl);
    expect(callbackResp.status).toBe(200);

    // Wait for authLogin to complete
    try {
      await loginPromise;
    } finally {
      cap.restore();
    }

    // Verify JSON output
    const jsonLine = cap.logs.find((l) => l.includes("authenticated"));
    expect(jsonLine).toBeDefined();
    if (!jsonLine) {
      throw new Error("authLogin did not emit JSON output");
    }
    const output = JSON.parse(jsonLine);
    expect(output.authenticated).toBe(true);

    // Verify auth.json was written with correct data
    const authJsonPath = join(tempDir, "reddit-saved", "auth.json");
    expect(existsSync(authJsonPath)).toBe(true);
    const authData = JSON.parse(await Bun.file(authJsonPath).text());
    expect(authData.username).toBe("flaguser");
    expect(authData.accessToken).toBe("flag-access-token");

    expect(spawn.calls).toHaveLength(0);
    spawn.restore();
    restoreFetch();
  });

  test("authLogin opens browser only when --open-browser is passed", async () => {
    process.env.REDDIT_CLIENT_ID = undefined;
    process.env.REDDIT_CLIENT_SECRET = undefined;

    const realFetch = globalThis.fetch;
    const spawn = captureBrowserSpawn();

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("/api/v1/access_token")) {
        return Response.json({
          access_token: "opened-access-token",
          refresh_token: "opened-refresh-token",
          expires_in: 3600,
          token_type: "bearer",
        });
      }
      if (url.includes("/api/v1/me")) {
        return Response.json({ name: "openeduser" });
      }
      if (url.includes("127.0.0.1") || url.includes("localhost")) {
        return realFetch(input, init);
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const { authLogin } = await import("../src/auth/login");
    const cap = captureConsole();

    const loginPromise = authLogin(
      {
        "client-id": "opened-client-id",
        "client-secret": "opened-client-secret",
        "open-browser": true,
        port: String(21_000 + Math.floor(Math.random() * 1000)),
      },
      [],
    );

    const maxWait = 5000;
    const start = Date.now();
    let authorizeUrl = "";
    while (Date.now() - start < maxWait) {
      const urlLine = cap.errors.find((e) => e.includes("reddit.com/api/v1/authorize"));
      if (urlLine) {
        const match = urlLine.match(/https?:\/\/\S+/);
        if (match) {
          authorizeUrl = match[0];
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(authorizeUrl).toContain("reddit.com/api/v1/authorize");
    expect(spawn.calls).toHaveLength(1);

    const stateMatch = authorizeUrl.match(/state=([^&]+)/);
    const redirectMatch = authorizeUrl.match(/redirect_uri=([^&]+)/);
    if (!stateMatch || !redirectMatch) {
      throw new Error("Authorize URL did not include state or redirect_uri");
    }
    const redirectUri = decodeURIComponent(redirectMatch[1]);
    const portMatch = redirectUri.match(/:(\d+)\//);
    if (!portMatch) {
      throw new Error("redirect_uri did not include a port");
    }

    const callbackUrl = `http://127.0.0.1:${portMatch[1]}/callback?code=test_code&state=${stateMatch[1]}`;
    const callbackResp = await realFetch(callbackUrl);
    expect(callbackResp.status).toBe(200);

    try {
      await loginPromise;
    } finally {
      cap.restore();
      spawn.restore();
      restoreFetch();
    }

    const authJsonPath = join(tempDir, "reddit-saved", "auth.json");
    const authData = JSON.parse(await Bun.file(authJsonPath).text());
    expect(authData.username).toBe("openeduser");
    expect(authData.accessToken).toBe("opened-access-token");
  });
});

// ---------------------------------------------------------------------------
// Human mode tests
// ---------------------------------------------------------------------------

describe("auth status — human mode", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `cli-auth-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    process.env.REDDIT_SAVED_CONFIG_DIR = join(tempDir, "reddit-saved");
    setOutputMode(true, false, false);
  });

  afterEach(() => {
    setOutputMode(false, false, false);
    process.env.REDDIT_SAVED_CONFIG_DIR = originalEnv.REDDIT_SAVED_CONFIG_DIR;
    if (!originalEnv.REDDIT_SAVED_CONFIG_DIR) {
      Reflect.deleteProperty(process.env, "REDDIT_SAVED_CONFIG_DIR");
    }
    if (originalEnv.REDDIT_CLIENT_SECRET !== undefined) {
      process.env.REDDIT_CLIENT_SECRET = originalEnv.REDDIT_CLIENT_SECRET;
    } else {
      process.env.REDDIT_CLIENT_SECRET = undefined;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("shows human-readable not authenticated message", async () => {
    const { authStatus } = await import("../src/auth/status");
    const cap = captureConsole();
    try {
      await authStatus();
      expect(cap.logs[0]).toContain("Not authenticated");
    } finally {
      cap.restore();
    }
  });

  test("shows human-readable auth section when authenticated", async () => {
    const configDir = join(tempDir, "reddit-saved");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "auth.json"),
      JSON.stringify({
        accessToken: "test-token",
        refreshToken: "test-refresh",
        tokenExpiry: Date.now() + 3600_000,
        username: "humanuser",
        clientId: "test-client-id",
      }),
    );
    process.env.REDDIT_CLIENT_SECRET = "test-secret";

    const { authStatus } = await import("../src/auth/status");
    const cap = captureConsole();
    try {
      await authStatus();
      const allOutput = cap.logs.join("\n");
      expect(allOutput).toContain("Authentication");
      expect(allOutput).toContain("humanuser");
      expect(allOutput).toContain("valid");
    } finally {
      cap.restore();
    }
  });
});

describe("auth logout — human mode", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `cli-auth-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    process.env.REDDIT_SAVED_CONFIG_DIR = join(tempDir, "reddit-saved");
    setOutputMode(true, false, false);
  });

  afterEach(() => {
    setOutputMode(false, false, false);
    process.env.REDDIT_SAVED_CONFIG_DIR = originalEnv.REDDIT_SAVED_CONFIG_DIR;
    if (!originalEnv.REDDIT_SAVED_CONFIG_DIR) {
      Reflect.deleteProperty(process.env, "REDDIT_SAVED_CONFIG_DIR");
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("shows human-readable logout message", async () => {
    const { authLogout } = await import("../src/auth/logout");
    const cap = captureConsole();
    try {
      await authLogout();
      expect(cap.errors[0]).toContain("Logged out");
    } finally {
      cap.restore();
    }
  });
});
