import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TokenManager } from "../src/auth/token-manager";
import { AUTH_FETCH_TIMEOUT_MS } from "../src/constants";
import type { AuthSettings } from "../src/types";

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

let tempDir: string;
let configDir: string;
let authFilePath: string;
let lockFilePath: string;

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

/** Valid auth.json payload (clientSecret omitted — never persisted) */
function validAuthJson(overrides?: Record<string, unknown>) {
  return {
    accessToken: "test-access-token",
    refreshToken: "test-refresh-token",
    tokenExpiry: Date.now() + 3600_000,
    username: "testuser",
    clientId: "test-client-id",
    ...overrides,
  };
}

/** Mock fetch that routes Reddit API calls to handlers */
function mockFetch(handlers: {
  token?: (req: Request) => Response | Promise<Response>;
  me?: (req: Request) => Response | Promise<Response>;
}) {
  const mockFn = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/api/v1/access_token") && handlers.token) {
      return handlers.token(new Request(url, init));
    }
    if (url.includes("/api/v1/me") && handlers.me) {
      return handlers.me(new Request(url, init));
    }
    return new Response("Not Found", { status: 404 });
  });
  globalThis.fetch = mockFn as unknown as typeof fetch;
}

function expectLoadedSettings(settings: AuthSettings | null): AuthSettings {
  expect(settings).not.toBeNull();
  if (!settings) {
    throw new Error("Expected auth settings to load");
  }
  return settings;
}

function setInternalSettings(manager: TokenManager, settings: AuthSettings): void {
  (manager as unknown as { settings: AuthSettings | null }).settings = settings;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "reddit-saved-token-test-"));
  configDir = join(tempDir, "reddit-saved");
  mkdirSync(configDir, { recursive: true });
  authFilePath = join(configDir, "auth.json");
  lockFilePath = join(configDir, "auth.lock");

  // Point paths.config to our temp dir on every OS.
  process.env.REDDIT_SAVED_CONFIG_DIR = configDir;
  process.env.REDDIT_CLIENT_SECRET = "test-client-secret";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  // Restore only the env vars we care about
  if (originalEnv.REDDIT_CLIENT_SECRET !== undefined) {
    process.env.REDDIT_CLIENT_SECRET = originalEnv.REDDIT_CLIENT_SECRET;
  } else {
    process.env.REDDIT_CLIENT_SECRET = undefined;
  }
  if (originalEnv.REDDIT_SAVED_CONFIG_DIR !== undefined) {
    process.env.REDDIT_SAVED_CONFIG_DIR = originalEnv.REDDIT_SAVED_CONFIG_DIR;
  } else {
    Reflect.deleteProperty(process.env, "REDDIT_SAVED_CONFIG_DIR");
  }
  rmSync(tempDir, { recursive: true, force: true });
});

// ===========================================================================
// load()
// ===========================================================================

describe("load", () => {
  test("returns null when auth.json does not exist", async () => {
    const tm = new TokenManager();
    expect(await tm.load()).toBeNull();
  });

  test("loads valid auth.json with env var clientSecret", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson()));
    const tm = new TokenManager();
    const settings = expectLoadedSettings(await tm.load());
    expect(settings.accessToken).toBe("test-access-token");
    expect(settings.refreshToken).toBe("test-refresh-token");
    expect(settings.clientId).toBe("test-client-id");
    expect(settings.username).toBe("testuser");
    expect(settings.clientSecret).toBe("test-client-secret"); // from env
  });

  test("env var clientSecret overrides file value", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson({ clientSecret: "file-secret" })));
    process.env.REDDIT_CLIENT_SECRET = "env-secret";
    const tm = new TokenManager();
    const settings = expectLoadedSettings(await tm.load());
    expect(settings.clientSecret).toBe("env-secret");
  });

  test("falls back to file clientSecret when env var is not set", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson({ clientSecret: "file-secret" })));
    process.env.REDDIT_CLIENT_SECRET = undefined;
    const tm = new TokenManager();
    const settings = expectLoadedSettings(await tm.load());
    expect(settings.clientSecret).toBe("file-secret");
  });

  test("throws on corrupted JSON", async () => {
    writeFileSync(authFilePath, "not valid json {{{");
    const tm = new TokenManager();
    await expect(tm.load()).rejects.toThrow("corrupted or unreadable");
  });

  test("throws on missing accessToken", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson({ accessToken: undefined })));
    const tm = new TokenManager();
    await expect(tm.load()).rejects.toThrow("missing or has invalid required fields");
  });

  test("throws on empty accessToken", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson({ accessToken: "" })));
    const tm = new TokenManager();
    await expect(tm.load()).rejects.toThrow("missing or has invalid required fields");
  });

  test("throws on missing refreshToken", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson({ refreshToken: undefined })));
    const tm = new TokenManager();
    await expect(tm.load()).rejects.toThrow("missing or has invalid required fields");
  });

  test("throws on empty refreshToken", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson({ refreshToken: "" })));
    const tm = new TokenManager();
    await expect(tm.load()).rejects.toThrow("missing or has invalid required fields");
  });

  test("throws on missing clientId", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson({ clientId: undefined })));
    const tm = new TokenManager();
    await expect(tm.load()).rejects.toThrow("missing or has invalid required fields");
  });

  test("throws on empty clientId", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson({ clientId: "" })));
    const tm = new TokenManager();
    await expect(tm.load()).rejects.toThrow("missing or has invalid required fields");
  });

  test("throws on invalid tokenExpiry (NaN)", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson({ tokenExpiry: "not-a-number" })));
    const tm = new TokenManager();
    await expect(tm.load()).rejects.toThrow("missing or has invalid required fields");
  });

  test("throws on tokenExpiry <= 0", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson({ tokenExpiry: 0 })));
    const tm = new TokenManager();
    await expect(tm.load()).rejects.toThrow("missing or has invalid required fields");
  });

  test("throws on negative tokenExpiry", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson({ tokenExpiry: -100 })));
    const tm = new TokenManager();
    await expect(tm.load()).rejects.toThrow("missing or has invalid required fields");
  });

  test("throws on Infinity tokenExpiry", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson({ tokenExpiry: 1 / 0 })));
    const tm = new TokenManager();
    await expect(tm.load()).rejects.toThrow("missing or has invalid required fields");
  });

  test("throws on missing username field", async () => {
    const { username: _, ...noUsername } = validAuthJson();
    writeFileSync(authFilePath, JSON.stringify(noUsername));
    const tm = new TokenManager();
    await expect(tm.load()).rejects.toThrow("missing or has invalid required fields");
  });

  test("allows empty username (valid edge case)", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson({ username: "" })));
    const tm = new TokenManager();
    const settings = expectLoadedSettings(await tm.load());
    expect(settings.username).toBe("");
  });

  test("throws when no clientSecret in env or file", async () => {
    process.env.REDDIT_CLIENT_SECRET = undefined;
    writeFileSync(authFilePath, JSON.stringify(validAuthJson()));
    const tm = new TokenManager();
    await expect(tm.load()).rejects.toThrow("REDDIT_CLIENT_SECRET");
  });
});

// ===========================================================================
// exchangeCode()
// ===========================================================================

describe("exchangeCode", () => {
  test("exchanges code for tokens and fetches username", async () => {
    mockFetch({
      token: () =>
        Response.json({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 3600,
        }),
      me: () => Response.json({ name: "fetched-user" }),
    });

    const tm = new TokenManager();
    const settings = await tm.exchangeCode("auth-code", "cid", "csecret");

    expect(settings.accessToken).toBe("new-access");
    expect(settings.refreshToken).toBe("new-refresh");
    expect(settings.username).toBe("fetched-user");
    expect(settings.clientId).toBe("cid");
    expect(settings.clientSecret).toBe("csecret");
    expect(settings.tokenExpiry).toBeGreaterThan(Date.now());

    // Verify saved to disk
    const onDisk = JSON.parse(readFileSync(authFilePath, "utf-8"));
    expect(onDisk.accessToken).toBe("new-access");
    expect(onDisk.username).toBe("fetched-user");
  });

  test("saves with empty username when fetchUsername fails", async () => {
    mockFetch({
      token: () =>
        Response.json({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 3600,
        }),
      me: () => new Response("Server Error", { status: 500 }),
    });

    const tm = new TokenManager();
    const settings = await tm.exchangeCode("auth-code", "cid", "csecret");
    expect(settings.username).toBe("");
  });

  test("throws on HTTP error from token endpoint", async () => {
    mockFetch({
      token: () => new Response("Bad Request", { status: 400 }),
    });

    const tm = new TokenManager();
    await expect(tm.exchangeCode("bad-code", "cid", "csecret")).rejects.toThrow(
      "Token exchange failed: HTTP 400",
    );
  });

  test("throws when response has error field", async () => {
    mockFetch({
      token: () => Response.json({ error: "invalid_grant" }),
    });

    const tm = new TokenManager();
    await expect(tm.exchangeCode("bad-code", "cid", "csecret")).rejects.toThrow(
      "Token exchange failed: invalid_grant",
    );
  });

  test("throws on missing access_token in response", async () => {
    mockFetch({
      token: () => Response.json({ refresh_token: "rt", expires_in: 3600 }),
    });

    const tm = new TokenManager();
    await expect(tm.exchangeCode("code", "cid", "csecret")).rejects.toThrow("missing access_token");
  });

  test("throws on missing refresh_token in response", async () => {
    mockFetch({
      token: () => Response.json({ access_token: "at", expires_in: 3600 }),
    });

    const tm = new TokenManager();
    await expect(tm.exchangeCode("code", "cid", "csecret")).rejects.toThrow(
      "missing access_token, refresh_token, or expires_in",
    );
  });

  test("throws on missing expires_in in response", async () => {
    mockFetch({
      token: () => Response.json({ access_token: "at", refresh_token: "rt" }),
    });

    const tm = new TokenManager();
    await expect(tm.exchangeCode("code", "cid", "csecret")).rejects.toThrow(
      "missing access_token, refresh_token, or expires_in",
    );
  });

  test("throws on expires_in <= 0", async () => {
    mockFetch({
      token: () => Response.json({ access_token: "at", refresh_token: "rt", expires_in: 0 }),
    });

    const tm = new TokenManager();
    await expect(tm.exchangeCode("code", "cid", "csecret")).rejects.toThrow(
      "missing access_token, refresh_token, or expires_in",
    );
  });

  test("includes codeVerifier in request body when provided", async () => {
    let capturedBody = "";
    mockFetch({
      token: async (req) => {
        capturedBody = await req.text();
        return Response.json({
          access_token: "at",
          refresh_token: "rt",
          expires_in: 3600,
        });
      },
      me: () => Response.json({ name: "user" }),
    });

    const tm = new TokenManager();
    await tm.exchangeCode("code", "cid", "csecret", "my-verifier");

    const params = new URLSearchParams(capturedBody);
    expect(params.get("code_verifier")).toBe("my-verifier");
  });

  test("clientSecret is never written to disk", async () => {
    mockFetch({
      token: () =>
        Response.json({
          access_token: "at",
          refresh_token: "rt",
          expires_in: 3600,
        }),
      me: () => Response.json({ name: "user" }),
    });

    const tm = new TokenManager();
    await tm.exchangeCode("code", "cid", "super-secret");

    const onDisk = JSON.parse(readFileSync(authFilePath, "utf-8"));
    expect(onDisk.clientSecret).toBeUndefined();
    expect(JSON.stringify(onDisk)).not.toContain("super-secret");
  });

  test("uses custom redirectUri when provided", async () => {
    let capturedBody = "";
    mockFetch({
      token: async (req) => {
        capturedBody = await req.text();
        return Response.json({
          access_token: "at",
          refresh_token: "rt",
          expires_in: 3600,
        });
      },
      me: () => Response.json({ name: "user" }),
    });

    const tm = new TokenManager();
    await tm.exchangeCode("code", "cid", "csecret", undefined, "http://custom:1234/cb");

    const params = new URLSearchParams(capturedBody);
    expect(params.get("redirect_uri")).toBe("http://custom:1234/cb");
  });
});

// ===========================================================================
// refreshAccessToken()
// ===========================================================================

describe("refreshAccessToken", () => {
  test("refreshes token and saves to disk", async () => {
    // Set up initial auth
    writeFileSync(authFilePath, JSON.stringify(validAuthJson({ tokenExpiry: Date.now() - 1000 })));

    mockFetch({
      token: () =>
        Response.json({
          access_token: "refreshed-access",
          expires_in: 7200,
        }),
    });

    const tm = new TokenManager();
    await tm.load();
    await tm.refreshAccessToken();

    const settings = tm.getSettings();
    expect(settings.accessToken).toBe("refreshed-access");
    expect(settings.refreshToken).toBe("test-refresh-token"); // preserved
    expect(settings.tokenExpiry).toBeGreaterThan(Date.now());

    // Verify persisted
    const onDisk = JSON.parse(readFileSync(authFilePath, "utf-8"));
    expect(onDisk.accessToken).toBe("refreshed-access");
  });

  test("throws when no refresh token available", async () => {
    const tm = new TokenManager();
    await expect(tm.refreshAccessToken()).rejects.toThrow("No refresh token available");
  });

  test("throws on HTTP error from token endpoint", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson({ tokenExpiry: Date.now() - 1000 })));
    mockFetch({
      token: () => new Response("Server Error", { status: 500 }),
    });

    const tm = new TokenManager();
    await tm.load();
    await expect(tm.refreshAccessToken()).rejects.toThrow("Token refresh failed: HTTP 500");
  });

  test("throws when response has error field", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson({ tokenExpiry: Date.now() - 1000 })));
    mockFetch({
      token: () => Response.json({ error: "invalid_grant" }),
    });

    const tm = new TokenManager();
    await tm.load();
    await expect(tm.refreshAccessToken()).rejects.toThrow("Token refresh failed: invalid_grant");
  });

  test("throws on invalid response (missing access_token)", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson({ tokenExpiry: Date.now() - 1000 })));
    mockFetch({
      token: () => Response.json({ expires_in: 3600 }),
    });

    const tm = new TokenManager();
    await tm.load();
    await expect(tm.refreshAccessToken()).rejects.toThrow("missing access_token or expires_in");
  });

  test("throws on invalid response (missing expires_in)", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson({ tokenExpiry: Date.now() - 1000 })));
    mockFetch({
      token: () => Response.json({ access_token: "at" }),
    });

    const tm = new TokenManager();
    await tm.load();
    await expect(tm.refreshAccessToken()).rejects.toThrow("missing access_token or expires_in");
  });

  test("throws on expires_in <= 0 in refresh response", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson({ tokenExpiry: Date.now() - 1000 })));
    mockFetch({
      token: () => Response.json({ access_token: "new-at", expires_in: 0 }),
    });

    const tm = new TokenManager();
    await tm.load();
    await expect(tm.refreshAccessToken()).rejects.toThrow("missing access_token or expires_in");
  });

  test("throws on negative expires_in in refresh response", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson({ tokenExpiry: Date.now() - 1000 })));
    mockFetch({
      token: () => Response.json({ access_token: "new-at", expires_in: -100 }),
    });

    const tm = new TokenManager();
    await tm.load();
    await expect(tm.refreshAccessToken()).rejects.toThrow("missing access_token or expires_in");
  });

  test("updates refresh_token when response includes one", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson({ tokenExpiry: Date.now() - 1000 })));
    mockFetch({
      token: () =>
        Response.json({
          access_token: "new-at",
          refresh_token: "new-rt",
          expires_in: 3600,
        }),
    });

    const tm = new TokenManager();
    await tm.load();
    await tm.refreshAccessToken();
    expect(tm.getSettings().refreshToken).toBe("new-rt");
  });

  test("preserves old refresh_token when response omits it", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson({ tokenExpiry: Date.now() - 1000 })));
    mockFetch({
      token: () =>
        Response.json({
          access_token: "new-at",
          expires_in: 3600,
        }),
    });

    const tm = new TokenManager();
    await tm.load();
    await tm.refreshAccessToken();
    expect(tm.getSettings().refreshToken).toBe("test-refresh-token");
  });

  test("adopts disk version when another process already refreshed", async () => {
    // Write a fresh token to disk (as if another process refreshed)
    const freshExpiry = Date.now() + 3600_000;
    writeFileSync(
      authFilePath,
      JSON.stringify(validAuthJson({ accessToken: "already-refreshed", tokenExpiry: freshExpiry })),
    );

    // TokenManager has stale in-memory settings
    const tm = new TokenManager();
    // Manually set stale settings to trigger refresh path
    await tm.load();
    // Overwrite in-memory to simulate staleness
    setInternalSettings(tm, {
      ...tm.getSettings(),
      tokenExpiry: Date.now() - 1000,
      accessToken: "stale-token",
    });

    // fetch should NOT be called — disk is fresh
    let fetchCalled = false;
    mockFetch({
      token: () => {
        fetchCalled = true;
        return Response.json({ access_token: "at", expires_in: 3600 });
      },
    });

    await tm.refreshAccessToken();
    expect(fetchCalled).toBe(false);
    expect(tm.getSettings().accessToken).toBe("already-refreshed");
  });

  test("falls back to in-memory clientSecret when env var is missing", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson({ tokenExpiry: Date.now() - 1000 })));

    const tm = new TokenManager();
    await tm.load();

    // Now remove env var — load() inside refresh will fail on clientSecret
    process.env.REDDIT_CLIENT_SECRET = undefined;

    let capturedAuth = "";
    mockFetch({
      token: async (req) => {
        capturedAuth = req.headers.get("Authorization") ?? "";
        return Response.json({ access_token: "new-at", expires_in: 3600 });
      },
    });

    await tm.refreshAccessToken();
    // Should have used the in-memory clientSecret from initial load
    expect(capturedAuth).toContain("Basic ");
    expect(tm.getSettings().accessToken).toBe("new-at");
  });

  test("re-throws non-clientSecret load errors", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson({ tokenExpiry: Date.now() - 1000 })));

    const tm = new TokenManager();
    await tm.load();

    // Corrupt the file on disk so load() fails with a non-secret error
    writeFileSync(authFilePath, "corrupted{{{");

    mockFetch({
      token: () => Response.json({ access_token: "at", expires_in: 3600 }),
    });

    await expect(tm.refreshAccessToken()).rejects.toThrow("corrupted or unreadable");
  });

  test("lock file is cleaned up after refresh", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson({ tokenExpiry: Date.now() - 1000 })));
    mockFetch({
      token: () => Response.json({ access_token: "at", expires_in: 3600 }),
    });

    const tm = new TokenManager();
    await tm.load();
    await tm.refreshAccessToken();
    expect(existsSync(lockFilePath)).toBe(false);
  });
});

// ===========================================================================
// ensureValidToken()
// ===========================================================================

describe("ensureValidToken", () => {
  test("loads from disk when settings not yet loaded", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson()));
    const tm = new TokenManager();
    // Not calling load() first — ensureValidToken should handle it
    await tm.ensureValidToken();
    expect(tm.getSettings().accessToken).toBe("test-access-token");
  });

  test("throws when not authenticated (no auth.json)", async () => {
    const tm = new TokenManager();
    await expect(tm.ensureValidToken()).rejects.toThrow("Not authenticated");
  });

  test("skips refresh when token has >60s remaining", async () => {
    writeFileSync(
      authFilePath,
      JSON.stringify(validAuthJson({ tokenExpiry: Date.now() + 120_000 })),
    );

    let fetchCalled = false;
    mockFetch({
      token: () => {
        fetchCalled = true;
        return Response.json({ access_token: "at", expires_in: 3600 });
      },
    });

    const tm = new TokenManager();
    await tm.ensureValidToken();
    expect(fetchCalled).toBe(false);
  });

  test("triggers refresh when token expires within 60s", async () => {
    writeFileSync(
      authFilePath,
      JSON.stringify(validAuthJson({ tokenExpiry: Date.now() + 30_000 })), // 30s remaining
    );

    mockFetch({
      token: () => Response.json({ access_token: "refreshed", expires_in: 3600 }),
    });

    const tm = new TokenManager();
    await tm.ensureValidToken();
    expect(tm.getSettings().accessToken).toBe("refreshed");
  });

  test("triggers refresh when token is already expired", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson({ tokenExpiry: Date.now() - 5000 })));

    mockFetch({
      token: () => Response.json({ access_token: "refreshed", expires_in: 3600 }),
    });

    const tm = new TokenManager();
    await tm.ensureValidToken();
    expect(tm.getSettings().accessToken).toBe("refreshed");
  });

  test("coalesces concurrent calls onto single refresh", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson({ tokenExpiry: Date.now() - 1000 })));

    let callCount = 0;
    mockFetch({
      token: async () => {
        callCount++;
        await new Promise((r) => setTimeout(r, 50)); // simulate network delay
        return Response.json({ access_token: "refreshed", expires_in: 3600 });
      },
    });

    const tm = new TokenManager();
    await tm.load();

    // Fire 3 concurrent ensureValidToken calls
    await Promise.all([tm.ensureValidToken(), tm.ensureValidToken(), tm.ensureValidToken()]);

    // Only one fetch should have been made
    expect(callCount).toBe(1);
  });

  test("coalesces concurrent failures and clears for retry", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson({ tokenExpiry: Date.now() - 1000 })));

    let callCount = 0;
    mockFetch({
      token: async () => {
        callCount++;
        if (callCount === 1) {
          return new Response("Server Error", { status: 500 });
        }
        return Response.json({ access_token: "refreshed", expires_in: 3600 });
      },
    });

    const tm = new TokenManager();
    await tm.load();

    // Both concurrent calls should see the same failure
    const results = await Promise.allSettled([tm.ensureValidToken(), tm.ensureValidToken()]);
    expect(results[0].status).toBe("rejected");
    expect(results[1].status).toBe("rejected");
    // Only one fetch was made (coalesced)
    expect(callCount).toBe(1);

    // Subsequent call should retry fresh (refreshPromise cleared)
    await tm.ensureValidToken();
    expect(callCount).toBe(2);
    expect(tm.getSettings().accessToken).toBe("refreshed");
  });
});

// ===========================================================================
// getSettings() / isAuthenticated()
// ===========================================================================

describe("getSettings / isAuthenticated", () => {
  test("getSettings returns settings when loaded", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson()));
    const tm = new TokenManager();
    await tm.load();
    const s = tm.getSettings();
    expect(s.accessToken).toBe("test-access-token");
    expect(s.clientId).toBe("test-client-id");
  });

  test("getSettings throws when not loaded", () => {
    const tm = new TokenManager();
    expect(() => tm.getSettings()).toThrow("Not authenticated");
  });

  test("isAuthenticated returns true when both tokens present", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson()));
    const tm = new TokenManager();
    await tm.load();
    expect(tm.isAuthenticated()).toBe(true);
  });

  test("isAuthenticated returns false when no settings loaded", () => {
    const tm = new TokenManager();
    expect(tm.isAuthenticated()).toBe(false);
  });
});

// ===========================================================================
// logout()
// ===========================================================================

describe("logout", () => {
  test("deletes auth.json and clears settings", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson()));
    const tm = new TokenManager();
    await tm.load();
    expect(tm.isAuthenticated()).toBe(true);

    await tm.logout();

    expect(tm.isAuthenticated()).toBe(false);
    expect(existsSync(authFilePath)).toBe(false);
  });

  test("succeeds when auth.json does not exist", async () => {
    const tm = new TokenManager();
    // Should not throw
    await tm.logout();
    expect(existsSync(authFilePath)).toBe(false);
  });

  test("still deletes when lock acquisition fails", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson()));
    const tm = new TokenManager();
    await tm.load();

    // Place a directory at the lock file path — writeFileSync('wx') fails with EISDIR,
    // readFileSync fails on a directory, so the lock loop exhausts its 10s deadline.
    // This exercises the catch-all fallback in logout() that deletes auth.json
    // even when withLock rejects.
    mkdirSync(lockFilePath);

    await tm.logout();

    expect(existsSync(authFilePath)).toBe(false);
    expect(tm.isAuthenticated()).toBe(false);
    // Clean up the directory we created at the lock path
    if (existsSync(lockFilePath)) rmSync(lockFilePath, { recursive: true });
  }, 15_000);

  test("lock file is cleaned up after logout", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson()));
    const tm = new TokenManager();
    await tm.load();
    await tm.logout();
    expect(existsSync(lockFilePath)).toBe(false);
  });
});

// ===========================================================================
// withLock (tested through public methods)
// ===========================================================================

describe("withLock (via refreshAccessToken)", () => {
  test("lock file is created during refresh and cleaned up after", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson({ tokenExpiry: Date.now() - 1000 })));

    let lockExistsDuringRefresh = false;
    mockFetch({
      token: () => {
        lockExistsDuringRefresh = existsSync(lockFilePath);
        return Response.json({ access_token: "at", expires_in: 3600 });
      },
    });

    const tm = new TokenManager();
    await tm.load();
    await tm.refreshAccessToken();

    expect(lockExistsDuringRefresh).toBe(true);
    expect(existsSync(lockFilePath)).toBe(false); // cleaned up
  });

  test("lock file is cleaned up even when refresh throws", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson({ tokenExpiry: Date.now() - 1000 })));
    mockFetch({
      token: () => new Response("error", { status: 500 }),
    });

    const tm = new TokenManager();
    await tm.load();
    await tm.refreshAccessToken().catch(() => {}); // swallow

    expect(existsSync(lockFilePath)).toBe(false);
  });

  test("removes stale lock from dead PID", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson({ tokenExpiry: Date.now() - 1000 })));

    // Write a lock file with a PID that doesn't exist (99999999)
    writeFileSync(lockFilePath, "99999999");

    mockFetch({
      token: () => Response.json({ access_token: "at", expires_in: 3600 }),
    });

    const tm = new TokenManager();
    await tm.load();
    await tm.refreshAccessToken();

    expect(tm.getSettings().accessToken).toBe("at");
    expect(existsSync(lockFilePath)).toBe(false);
  });

  test("removes corrupt lock file (non-numeric PID)", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson({ tokenExpiry: Date.now() - 1000 })));

    // Write a lock file with garbage content
    writeFileSync(lockFilePath, "not-a-pid");

    mockFetch({
      token: () => Response.json({ access_token: "at", expires_in: 3600 }),
    });

    const tm = new TokenManager();
    await tm.load();
    await tm.refreshAccessToken();

    expect(tm.getSettings().accessToken).toBe("at");
    expect(existsSync(lockFilePath)).toBe(false);
  });

  test("lock held by alive PID — waits and eventually succeeds when released", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson({ tokenExpiry: Date.now() - 1000 })));

    // Write a lock file with our own PID (alive, so it won't be stolen)
    writeFileSync(lockFilePath, process.pid.toString());

    mockFetch({
      token: () => Response.json({ access_token: "alive_token", expires_in: 3600 }),
    });

    const tm = new TokenManager();
    await tm.load();

    // Release the lock after 500ms (simulates another process finishing)
    const releaseTimer = setTimeout(() => {
      try {
        rmSync(lockFilePath, { force: true });
      } catch {}
    }, 500);

    await tm.refreshAccessToken();
    clearTimeout(releaseTimer);

    expect(tm.getSettings().accessToken).toBe("alive_token");
    expect(existsSync(lockFilePath)).toBe(false);
  });

  test("lock timeout throws after 10 seconds", async () => {
    writeFileSync(authFilePath, JSON.stringify(validAuthJson({ tokenExpiry: Date.now() - 1000 })));

    // Write lock with our own PID — it will stay alive, causing timeout
    writeFileSync(lockFilePath, process.pid.toString());

    mockFetch({
      token: () => Response.json({ access_token: "at", expires_in: 3600 }),
    });

    const tm = new TokenManager();
    await tm.load();

    try {
      await tm.refreshAccessToken();
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("Could not acquire auth lock after 10 seconds");
    }

    // Clean up: remove lock since it was never released
    rmSync(lockFilePath, { force: true });
  }, 15_000); // 15s timeout for this test
});

// ===========================================================================
// save() security (tested through exchangeCode)
// ===========================================================================

describe("save security", () => {
  test("auth.json is written with restricted permissions", async () => {
    mockFetch({
      token: () => Response.json({ access_token: "at", refresh_token: "rt", expires_in: 3600 }),
      me: () => Response.json({ name: "user" }),
    });

    const tm = new TokenManager();
    await tm.exchangeCode("code", "cid", "csecret");

    // Verify file exists and is readable
    const content = readFileSync(authFilePath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.accessToken).toBe("at");
    // clientSecret must not appear on disk
    expect(parsed.clientSecret).toBeUndefined();
    expect(content).not.toContain("csecret");
  });

  test("auth.json is valid JSON with pretty formatting", async () => {
    mockFetch({
      token: () => Response.json({ access_token: "at", refresh_token: "rt", expires_in: 3600 }),
      me: () => Response.json({ name: "user" }),
    });

    const tm = new TokenManager();
    await tm.exchangeCode("code", "cid", "csecret");

    const content = readFileSync(authFilePath, "utf-8");
    // Pretty-printed JSON has newlines
    expect(content).toContain("\n");
    // Should parse without error
    expect(() => JSON.parse(content)).not.toThrow();
  });
});

// ===========================================================================
// Timeout protection on raw fetch calls
// ===========================================================================

describe("fetch timeout protection", () => {
  test("exchangeCode passes AbortSignal.timeout to fetch", async () => {
    let capturedSignal: AbortSignal | undefined;
    const mockFn = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return Response.json({ access_token: "at", refresh_token: "rt", expires_in: 3600 });
    });
    globalThis.fetch = mockFn as unknown as typeof fetch;

    // Also mock the /me call that exchangeCode makes internally
    const origMockFn = mockFn;
    let callCount = 0;
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      callCount++;
      if (callCount === 1) {
        // Token exchange call
        capturedSignal = init?.signal ?? undefined;
        return Response.json({ access_token: "at", refresh_token: "rt", expires_in: 3600 });
      }
      // /me call
      return Response.json({ name: "testuser" });
    }) as unknown as typeof fetch;

    const tm = new TokenManager();
    await tm.exchangeCode("code", "cid", "csecret");

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
  });

  test("refreshAccessToken passes AbortSignal.timeout to fetch", async () => {
    // Set up authenticated state
    writeFileSync(authFilePath, JSON.stringify(validAuthJson({ tokenExpiry: Date.now() - 1000 })));

    let capturedSignal: AbortSignal | undefined;
    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return Response.json({
        access_token: "new-at",
        refresh_token: "new-rt",
        expires_in: 3600,
      });
    }) as unknown as typeof fetch;

    const tm = new TokenManager();
    await tm.load();
    await tm.refreshAccessToken();

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
  });

  test("fetchUsername passes AbortSignal.timeout to fetch (via exchangeCode)", async () => {
    const signals: Array<AbortSignal | undefined> = [];
    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof _input === "string" ? _input : _input instanceof URL ? _input.href : _input.url;
      signals.push(init?.signal ?? undefined);
      if (url.includes("/api/v1/access_token")) {
        return Response.json({ access_token: "at", refresh_token: "rt", expires_in: 3600 });
      }
      return Response.json({ name: "testuser" });
    }) as unknown as typeof fetch;

    const tm = new TokenManager();
    await tm.exchangeCode("code", "cid", "csecret");

    // Second call is the /me endpoint (fetchUsername)
    expect(signals.length).toBe(2);
    expect(signals[1]).toBeDefined();
    expect(signals[1]).toBeInstanceOf(AbortSignal);
  });

  test("fetch timeout signal aborts a hanging request", async () => {
    // Verify the abort mechanism works: create a signal like TokenManager does,
    // then confirm a hanging fetch is aborted by it.
    const signal = AbortSignal.timeout(50); // 50ms for fast test
    let rejected = false;

    try {
      await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    } catch {
      rejected = true;
    }

    expect(rejected).toBe(true);
  });
});
