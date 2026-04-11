/**
 * Shared test helpers for CLI tests.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthSettings, RedditItem, TokenProvider } from "@reddit-saved/core";

// ---------------------------------------------------------------------------
// Temp database
// ---------------------------------------------------------------------------

export function makeTempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "cli-test-"));
  return join(dir, "test.db");
}

// ---------------------------------------------------------------------------
// Mock Reddit items
// ---------------------------------------------------------------------------

export function makeItem(
  overrides: Partial<{
    id: string;
    title: string;
    subreddit: string;
    author: string;
    score: number;
    body: string;
    kind: string;
    created_utc: number;
  }>,
): RedditItem {
  const id = overrides.id ?? "abc123";
  return {
    kind: overrides.kind ?? "t3",
    data: {
      id,
      name: `${overrides.kind ?? "t3"}_${id}`,
      title: overrides.title ?? "Test post",
      author: overrides.author ?? "testuser",
      subreddit: overrides.subreddit ?? "test",
      permalink: `/r/${overrides.subreddit ?? "test"}/comments/${id}/test_post/`,
      created_utc: overrides.created_utc ?? 1700000000,
      score: overrides.score ?? 42,
      body: overrides.body,
    },
  };
}

// ---------------------------------------------------------------------------
// Console capture
// ---------------------------------------------------------------------------

export function captureConsole(): {
  logs: string[];
  errors: string[];
  restore: () => void;
} {
  const logs: string[] = [];
  const errors: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => errors.push(args.map(String).join(" "));
  return {
    logs,
    errors,
    restore: () => {
      console.log = origLog;
      console.error = origError;
    },
  };
}

// ---------------------------------------------------------------------------
// process.exit capture
// ---------------------------------------------------------------------------

export function captureExit(): {
  exitCode: number | null;
  restore: () => void;
} {
  const state = { exitCode: null as number | null };
  const originalExit = process.exit;
  process.exit = ((code?: number) => {
    state.exitCode = code ?? 0;
    // Throw to stop execution without actually exiting
    throw new ExitCaptured(code ?? 0);
  }) as never;
  return {
    get exitCode() {
      return state.exitCode;
    },
    restore: () => {
      process.exit = originalExit;
    },
  };
}

export class ExitCaptured extends Error {
  constructor(public code: number) {
    super(`process.exit(${code}) called`);
    this.name = "ExitCaptured";
  }
}

// ---------------------------------------------------------------------------
// Mock TokenProvider (for API-dependent tests)
// ---------------------------------------------------------------------------

export function createMockTokenProvider(overrides?: Partial<AuthSettings>): TokenProvider {
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
// Mock fetch for Reddit API
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

export function mockRedditFetch(handlers: {
  saved?: (req: Request) => Response | Promise<Response>;
  unsave?: (req: Request) => Response | Promise<Response>;
  me?: (req: Request) => Response | Promise<Response>;
  token?: (req: Request) => Response | Promise<Response>;
}): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/user/") && url.includes("/saved") && handlers.saved) {
      return handlers.saved(new Request(url, init));
    }
    if (url.includes("/api/unsave") && handlers.unsave) {
      return handlers.unsave(new Request(url, init));
    }
    if (url.includes("/api/v1/me") && handlers.me) {
      return handlers.me(new Request(url, init));
    }
    if (url.includes("/api/v1/access_token") && handlers.token) {
      return handlers.token(new Request(url, init));
    }
    return new Response("Not Found", { status: 404 });
  }) as typeof fetch;
}

export function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}
