/**
 * Shared bootstrap for CLI commands.
 *
 * Creates the core objects (storage, auth, API client) that most commands need,
 * handling auth checks and exit codes in one place.
 */

import {
  type ApiClientCallbacks,
  PerformanceMonitor,
  RedditApiClient,
  RequestQueue,
  SqliteAdapter,
  TagManager,
  TokenManager,
  paths,
} from "@reddit-saved/core";
import { clearProgress, printError, printProgress, printVerbose } from "./output";

export interface CliContext {
  storage: SqliteAdapter;
  tags: TagManager;
  tokenManager: TokenManager;
  apiClient?: RedditApiClient;
  queue?: RequestQueue;
  monitor: PerformanceMonitor;
  close: () => void;
}

export interface ContextOptions {
  /** Require authentication — exits with code 2 if not logged in */
  needsAuth?: boolean;
  /** Require API client — implies needsAuth */
  needsApi?: boolean;
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

  if (needsAuth) {
    let settings;
    try {
      settings = await tokenManager.load();
    } catch (err) {
      storage.close();
      throw err;
    }
    if (!settings) {
      printError("Not authenticated. Run 'reddit-saved auth login' first.", "AUTH_REQUIRED");
      storage.close();
      process.exit(2);
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

    apiClient = new RedditApiClient(tokenManager, queue, callbacks);
  }

  return {
    storage,
    tags,
    tokenManager,
    apiClient,
    queue,
    monitor,
    close: () => {
      clearProgress();
      storage.close();
    },
  };
}
