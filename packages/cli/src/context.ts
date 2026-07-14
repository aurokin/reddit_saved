/**
 * Shared bootstrap for CLI commands.
 *
 * Creates the core objects (storage, auth, API client) that most commands need,
 * handling auth checks and exit codes in one place.
 */

import {
  type ApiClientCallbacks,
  type AuthProvider,
  type AuthSettings,
  PerformanceMonitor,
  RedditApiClient,
  RequestQueue,
  SessionManager,
  SqliteAdapter,
  TagManager,
  TokenManager,
  paths,
} from "@reddit-cached/core";
import { clearProgress, printError, printProgress, printVerbose } from "./output";

export interface CliContext {
  storage: SqliteAdapter;
  tags: TagManager;
  tokenManager: TokenManager;
  apiClient?: RedditApiClient;
  queue?: RequestQueue;
  monitor: PerformanceMonitor;
  /** Set when auth was requested: false means no session and no OAuth
   *  credentials were found (only reachable with optionalAuth). */
  authAvailable?: boolean;
  close: () => void;
}

export interface ContextOptions {
  /** Require authentication — exits with code 2 if not logged in */
  needsAuth?: boolean;
  /** Require API client — implies needsAuth */
  needsApi?: boolean;
  /** With needsApi: don't exit when unauthenticated — API calls will throw
   *  instead, so callers that record provenance (jobs run) can capture the
   *  auth failure per step rather than dying before writing anything. */
  optionalAuth?: boolean;
  /** Override database path (from --db flag) */
  dbPath?: string;
}

export async function createContext(opts: ContextOptions = {}): Promise<CliContext> {
  const dbPath = opts.dbPath ?? paths.database;
  const storage = new SqliteAdapter(dbPath);
  const tags = new TagManager(storage.getDb());
  const monitor = new PerformanceMonitor();
  const tokenManager = new TokenManager();

  const needsAuth = opts.needsAuth || opts.needsApi;

  // Session (extension cookie) auth wins when present, matching the web app's
  // priority — it represents an explicit choice to install the companion
  // extension. OAuth auth.json remains the fallback.
  let authProvider: AuthProvider = tokenManager;
  let authAvailable: boolean | undefined;

  if (needsAuth) {
    authAvailable = true;
    const sessionManager = new SessionManager();
    try {
      await sessionManager.load();
    } catch {
      // Missing/corrupt session.json is normal for OAuth users — fall through
    }

    if (sessionManager.isAuthenticated()) {
      authProvider = sessionManager;
    } else {
      let settings: AuthSettings | null;
      try {
        settings = await tokenManager.load();
      } catch (err) {
        storage.close();
        throw err;
      }
      if (!settings) {
        if (!opts.optionalAuth) {
          printError(
            "Not authenticated. Connect the browser extension or run 'reddit-cached auth login'.",
            "AUTH_REQUIRED",
          );
          storage.close();
          process.exit(2);
        }
        authAvailable = false;
      }
    }
  }

  let apiClient: RedditApiClient | undefined;
  let queue: RequestQueue | undefined;

  if (opts.needsApi) {
    queue = new RequestQueue();

    const callbacks: ApiClientCallbacks = {
      onProgress: (fetched, total) => {
        const totalStr = total ? `/${total}` : "";
        printProgress(`Fetching... ${fetched}${totalStr} items`);
      },
      onRateLimit: (waitMs, remaining) => {
        printVerbose(`Rate limited: waiting ${Math.ceil(waitMs / 1000)}s (${remaining} remaining)`);
      },
      onError: (error, retryable) => {
        if (retryable) {
          printVerbose(`Retryable error: ${error.message}`);
        }
      },
      onPageFetched: (pageNum, itemCount, cursor) => {
        printVerbose(`Page ${pageNum}: ${itemCount} items (cursor: ${cursor})`);
      },
    };

    apiClient = new RedditApiClient(authProvider, queue, callbacks);
  }

  return {
    storage,
    tags,
    tokenManager,
    apiClient,
    queue,
    monitor,
    authAvailable,
    close: () => {
      clearProgress();
      storage.close();
    },
  };
}
