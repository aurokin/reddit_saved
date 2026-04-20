/**
 * Shared bootstrap for Hono routes. Creates core objects (storage, auth, API client),
 * respects auth.lock, and exposes a singleton accessible via the Hono `c.var.app` context.
 */
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  type ApiClientCallbacks,
  type AuthContext,
  type AuthProvider,
  PerformanceMonitor,
  RedditApiClient,
  RequestQueue,
  SessionManager,
  SqliteAdapter,
  TagManager,
  TokenManager,
  paths,
} from "@reddit-saved/core";
import { type AuthMode, selectAuthMode } from "./auth-routing";

export interface SyncCapableAuthProvider extends AuthProvider {
  createPinnedProvider(): Promise<AuthProvider>;
}

export interface AppContext {
  storage: SqliteAdapter;
  tags: TagManager;
  tokenManager: TokenManager;
  sessionManager: SessionManager;
  authProvider: SyncCapableAuthProvider;
  apiClient: RedditApiClient;
  queue: RequestQueue;
  monitor: PerformanceMonitor;
  /** TEST_MODE=1 — skips real OAuth, allows seeded auth.json to act as authenticated state. */
  testMode: boolean;
  /** Dbpath resolved at boot. */
  dbPath: string;
  /** Currently running sync promise (single-flight). */
  activeSync: AbortController | null;
}

function resolveDbPath(): string {
  const envPath = process.env.REDDIT_SAVED_DB;
  if (envPath) return resolve(envPath);
  return paths.database;
}

/**
 * Routes API requests to whichever auth mode is currently configured.
 * Session (cookie) auth wins when present — it represents an explicit choice
 * by the user to install the companion extension. OAuth remains the fallback
 * for users who registered an app the old-fashioned way.
 *
 * `ensureValid()` is the lazy-load hook: it triggers session.json read on first
 * use. After that, `getAuthContext()` is a sync read of in-memory state.
 */
class CompositeAuthProvider implements SyncCapableAuthProvider {
  private activeMode: AuthMode | null = null;

  constructor(
    private readonly session: SessionManager,
    private readonly token: TokenManager,
  ) {}

  async ensureValid(): Promise<void> {
    this.activeMode = await selectAuthMode(this.session, this.token);
  }

  getAuthContext(): AuthContext {
    if (this.activeMode === "oauth") return this.token.getAuthContext();
    if (this.session.isAuthenticated()) return this.session.getAuthContext();
    return this.token.getAuthContext();
  }

  isAuthenticated(): boolean {
    return this.session.isAuthenticated() || this.token.isAuthenticated();
  }

  async createPinnedProvider(): Promise<AuthProvider> {
    const sessionUsername = this.session.getSummary()?.username ?? null;
    const mode = await selectAuthMode(this.session, this.token, {
      sessionUsernameHint: sessionUsername,
    });
    return new PinnedAuthProvider(mode, sessionUsername, this.session, this.token);
  }
}

class PinnedAuthProvider implements AuthProvider {
  private activeMode: AuthMode;

  constructor(
    mode: AuthMode,
    private readonly sessionUsernameHint: string | null,
    private readonly session: SessionManager,
    private readonly token: TokenManager,
  ) {
    this.activeMode = mode;
  }

  async ensureValid(): Promise<void> {
    if (this.activeMode === "session") {
      this.activeMode = await selectAuthMode(this.session, this.token, {
        sessionUsernameHint: this.sessionUsernameHint,
      });
      return;
    }
    await this.token.ensureValid();
  }

  getAuthContext(): AuthContext {
    return this.activeMode === "session"
      ? this.session.getAuthContext()
      : this.token.getAuthContext();
  }

  isAuthenticated(): boolean {
    return this.activeMode === "session"
      ? this.session.isAuthenticated()
      : this.token.isAuthenticated();
  }
}

let singleton: AppContext | null = null;

export function getAppContext(): AppContext {
  if (singleton) return singleton;

  const testMode = process.env.TEST_MODE === "1" || process.env.TEST_MODE === "true";
  if (testMode && process.env.NODE_ENV === "production") {
    // Safety assertion: TEST_MODE bypasses OAuth and must never run in prod.
    throw new Error(
      "TEST_MODE is set in a production NODE_ENV — refusing to start. " +
        "Unset TEST_MODE or run in a non-production environment.",
    );
  }

  const dbPath = resolveDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });

  const storage = new SqliteAdapter(dbPath);
  const tags = new TagManager(storage.getDb());
  const monitor = new PerformanceMonitor();
  const tokenManager = new TokenManager();
  const sessionManager = new SessionManager();
  const queue = new RequestQueue();

  const callbacks: ApiClientCallbacks = {
    onError: (error) => {
      console.error("[api-client]", error.message);
    },
  };

  const authProvider = new CompositeAuthProvider(sessionManager, tokenManager);
  const apiClient = new RedditApiClient(authProvider, queue, callbacks);

  singleton = {
    storage,
    tags,
    tokenManager,
    sessionManager,
    authProvider,
    apiClient,
    queue,
    monitor,
    testMode,
    dbPath,
    activeSync: null,
  };
  return singleton;
}

export function closeAppContext(): void {
  if (!singleton) return;
  singleton.activeSync?.abort();
  singleton.storage.close();
  singleton = null;
}
