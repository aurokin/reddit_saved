import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import {
  AUTH_FETCH_TIMEOUT_MS,
  CONTENT_TYPE_FORM_URLENCODED,
  HEADER_AUTHORIZATION,
  HEADER_CONTENT_TYPE,
  HEADER_USER_AGENT,
  OAUTH_REDIRECT_URI,
  REDDIT_OAUTH_BASE_URL,
  REDDIT_OAUTH_TOKEN_URL,
  USER_AGENT_TEMPLATE,
  VERSION,
} from "../constants";
import type { AuthSettings } from "../types";
import { paths } from "../utils/paths";

/**
 * Manages OAuth tokens: exchange, refresh, validation, persistence.
 * Uses file-based locking to prevent concurrent token refresh races
 * between CLI and web processes sharing the same auth.json.
 */
export class TokenManager {
  private settings: AuthSettings | null = null;

  /** Load auth settings from disk, or return null if not authenticated */
  async load(): Promise<AuthSettings | null> {
    const file = Bun.file(paths.authFile);
    if (!(await file.exists())) return null;

    let loaded: Partial<AuthSettings>;
    try {
      loaded = (await file.json()) as Partial<AuthSettings>;
    } catch (err) {
      throw new Error(
        `auth.json is corrupted or unreadable. Delete it and re-authenticate with 'reddit-saved auth login'. (${err})`,
      );
    }

    // Validate required fields before spreading into settings
    if (
      typeof loaded.accessToken !== "string" ||
      loaded.accessToken.length === 0 ||
      typeof loaded.refreshToken !== "string" ||
      loaded.refreshToken.length === 0 ||
      typeof loaded.clientId !== "string" ||
      loaded.clientId.length === 0 ||
      typeof loaded.tokenExpiry !== "number" ||
      !Number.isFinite(loaded.tokenExpiry) ||
      loaded.tokenExpiry <= 0 ||
      typeof loaded.username !== "string" // empty string is valid (fetchUsername may have failed during initial auth)
    ) {
      throw new Error(
        "auth.json is missing or has invalid required fields. " +
          "Re-authenticate with 'reddit-saved auth login'.",
      );
    }

    const clientSecret = process.env.REDDIT_CLIENT_SECRET ?? loaded.clientSecret;
    if (!clientSecret) {
      const err = new Error(
        "REDDIT_CLIENT_SECRET env var is not set. This is required for token refresh. " +
          "Set the env var and retry, or re-authenticate with 'reddit-saved auth login'.",
      ) as Error & { code: string };
      err.code = "CLIENT_SECRET_MISSING";
      throw err;
    }
    this.settings = { ...loaded, clientSecret } as AuthSettings;
    return this.settings;
  }

  /** Save current settings to disk with restricted permissions.
   * Uses write-rename for atomic replacement. writeFileSync with mode: 0o600
   * creates the file with restricted permissions from the start (no world-readable window).
   * clientSecret is never written to disk — it is sourced from REDDIT_CLIENT_SECRET env var at runtime. */
  private save(): void {
    if (!this.settings) {
      throw new Error("Bug: save() called with no settings loaded");
    }
    mkdirSync(paths.config, { recursive: true, mode: 0o700 });
    const filePath = paths.authFile;
    const tmp = `${filePath}.tmp`;
    const { clientSecret: _secret, ...toWrite } = this.settings;
    writeFileSync(tmp, JSON.stringify(toWrite, null, 2), { mode: 0o600 });
    renameSync(tmp, filePath);
  }

  /** Exchange authorization code for tokens (with PKCE code_verifier) */
  async exchangeCode(
    code: string,
    clientId: string,
    clientSecret: string,
    codeVerifier?: string,
    redirectUri?: string,
  ): Promise<AuthSettings> {
    const actualRedirect = redirectUri ?? OAUTH_REDIRECT_URI;
    const auth = btoa(`${clientId}:${clientSecret}`);

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: actualRedirect,
      ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
    });

    const userAgent = USER_AGENT_TEMPLATE.replace("{version}", VERSION).replace(
      "{username}",
      "unknown",
    );

    const response = await fetch(REDDIT_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        [HEADER_AUTHORIZATION]: `Basic ${auth}`,
        [HEADER_CONTENT_TYPE]: CONTENT_TYPE_FORM_URLENCODED,
        [HEADER_USER_AGENT]: userAgent,
      },
      body,
      signal: AbortSignal.timeout(AUTH_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Token exchange failed: HTTP ${response.status} — ${text.slice(0, 200)}`);
    }

    const json = await response.json();
    if (json.error) {
      throw new Error(`Token exchange failed: ${json.error}`);
    }

    if (
      typeof json.access_token !== "string" ||
      typeof json.expires_in !== "number" ||
      json.expires_in <= 0 ||
      typeof json.refresh_token !== "string"
    ) {
      throw new Error(
        "Token exchange returned invalid response: missing access_token, refresh_token, or expires_in",
      );
    }

    this.settings = {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      tokenExpiry: Date.now() + json.expires_in * 1000,
      username: "",
      clientId,
      clientSecret,
    };

    // Fetch username before first save so we don't persist an empty username.
    // If it fails, save anyway — credentials are still valid.
    try {
      this.settings = { ...this.settings, username: await this.fetchUsername() };
    } catch {
      // Username will remain empty until the user re-authenticates
    }
    this.save();

    return this.settings;
  }

  /** Refresh the access token using the refresh token */
  async refreshAccessToken(): Promise<void> {
    if (!this.settings?.refreshToken) {
      throw new Error("No refresh token available. Please authenticate first.");
    }

    await this.withLock(async () => {
      // Re-read settings in case another process refreshed while we waited for the lock.
      // If load() fails (e.g. clientSecret not in env but was valid in-memory from exchangeCode),
      // fall back to the in-memory settings rather than crashing mid-refresh.
      const inMemorySecret = this.settings?.clientSecret;
      let freshSettings: AuthSettings | null = null;
      try {
        freshSettings = await this.load();
      } catch (loadErr) {
        // Only swallow errors about missing clientSecret (expected when env var is unset).
        // Re-throw I/O errors, corruption, or validation failures — those indicate real problems.
        if (loadErr instanceof Error && (loadErr as Error & { code?: string }).code === "CLIENT_SECRET_MISSING") {
          // Fall through to use in-memory settings below.
        } else {
          throw loadErr;
        }
      }
      if (freshSettings && freshSettings.tokenExpiry > Date.now() + 60_000) {
        // Token still fresh — adopt the disk version (another process may have refreshed).
        // Restore in-memory clientSecret since disk never stores the secret.
        // load() guarantees freshSettings.clientSecret is non-empty, but guard defensively.
        const resolvedSecret = freshSettings.clientSecret || inMemorySecret;
        if (!resolvedSecret)
          throw new Error("clientSecret unavailable. Set REDDIT_CLIENT_SECRET and retry.");
        this.settings = { ...freshSettings, clientSecret: resolvedSecret };
        return;
      }

      // Use fresh settings from disk if available, otherwise fall back to in-memory.
      // Preserve in-memory clientSecret if disk/env didn't have one.
      // Clone to avoid mutating this.settings through the alias when both point to the same object.
      const base = freshSettings ?? this.settings;
      if (!base)
        throw new Error(
          "Auth settings unavailable. Credentials may have been removed during refresh.",
        );
      const current =
        !base.clientSecret && inMemorySecret
          ? { ...base, clientSecret: inMemorySecret }
          : { ...base };
      const auth = btoa(`${current.clientId}:${current.clientSecret}`);

      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: current.refreshToken,
      });

      const userAgent = USER_AGENT_TEMPLATE.replace("{version}", VERSION).replace(
        "{username}",
        current.username || "unknown",
      );

      const response = await fetch(REDDIT_OAUTH_TOKEN_URL, {
        method: "POST",
        headers: {
          [HEADER_AUTHORIZATION]: `Basic ${auth}`,
          [HEADER_CONTENT_TYPE]: CONTENT_TYPE_FORM_URLENCODED,
          [HEADER_USER_AGENT]: userAgent,
        },
        body,
        signal: AbortSignal.timeout(AUTH_FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Token refresh failed: HTTP ${response.status} — ${text.slice(0, 200)}`);
      }

      const json = await response.json();
      if (json.error) {
        throw new Error(`Token refresh failed: ${json.error}`);
      }

      if (
        typeof json.access_token !== "string" ||
        typeof json.expires_in !== "number" ||
        json.expires_in <= 0
      ) {
        throw new Error(
          "Token refresh returned invalid response: missing access_token or expires_in",
        );
      }

      // Atomic pointer swap — prevents concurrent readers from seeing partially-updated state
      this.settings = {
        ...current,
        accessToken: json.access_token,
        tokenExpiry: Date.now() + json.expires_in * 1000,
        ...(json.refresh_token ? { refreshToken: json.refresh_token } : {}),
      };
      this.save();
    });
  }

  /** Coalesces concurrent callers onto a single refresh to avoid thundering herd */
  private refreshPromise: Promise<void> | null = null;

  /** Ensure we have a valid (non-expired) access token */
  async ensureValidToken(): Promise<void> {
    if (!this.settings) {
      const loaded = await this.load();
      if (!loaded) throw new Error("Not authenticated. Run 'reddit-saved auth login' first.");
    }

    // Snapshot after possible concurrent load() — avoid unsafe non-null assertion
    const settings = this.settings;
    if (!settings) throw new Error("Not authenticated. Run 'reddit-saved auth login' first.");

    // Refresh if token expires within 60 seconds
    if (Date.now() >= settings.tokenExpiry - 60_000) {
      this.refreshPromise ??= this.refreshAccessToken().finally(() => {
        this.refreshPromise = null;
      });
      await this.refreshPromise;
    }
  }

  /** Get the current auth settings (throws if not authenticated) */
  getSettings(): AuthSettings {
    if (!this.settings) {
      throw new Error("Not authenticated. Run 'reddit-saved auth login' first.");
    }
    return this.settings;
  }

  /** Check if credentials are present (does not verify token validity) */
  isAuthenticated(): boolean {
    return !!(this.settings?.accessToken && this.settings?.refreshToken);
  }

  /** Clear all auth data. Acquires lock to prevent a concurrent refresh from
   *  rewriting auth.json after we delete it. Falls back to best-effort deletion
   *  if the lock can't be acquired (user explicitly asked to log out). */
  async logout(): Promise<void> {
    const deleteAuthFile = () => {
      try {
        unlinkSync(paths.authFile);
      } catch {
        /* Already removed */
      }
      this.settings = null;
    };
    try {
      await this.withLock(async () => {
        deleteAuthFile();
      });
    } catch {
      // Lock acquisition failed (e.g. hung process) — delete anyway as best effort
      deleteAuthFile();
    }
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /** Fetch username via direct fetch (bypasses RequestQueue).
   *  Used during initial auth when the queue isn't set up yet.
   *  RedditApiClient.fetchUsername is the queue-backed equivalent for normal operation. */
  private async fetchUsername(): Promise<string> {
    const userAgent = USER_AGENT_TEMPLATE.replace("{version}", VERSION).replace(
      "{username}",
      "unknown",
    );

    if (!this.settings) throw new Error("Bug: fetchUsername called before settings are set");

    const response = await fetch(`${REDDIT_OAUTH_BASE_URL}/api/v1/me`, {
      headers: {
        [HEADER_AUTHORIZATION]: `Bearer ${this.settings.accessToken}`,
        [HEADER_USER_AGENT]: userAgent,
      },
      signal: AbortSignal.timeout(AUTH_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to fetch username: HTTP ${response.status} — ${text.slice(0, 200)}`);
    }

    const json = await response.json();
    if (json.error) {
      throw new Error(`Failed to fetch username: ${json.error}`);
    }

    if (!json.name) {
      throw new Error("Reddit API did not return a username. Account may be suspended or deleted.");
    }
    return json.name;
  }

  /**
   * File-based lock for token refresh concurrency.
   * Prevents CLI + web from refreshing simultaneously and invalidating each other.
   * Throws if lock cannot be acquired after retries.
   *
   * LIMITATION: The stale-lock cleanup has a TOCTOU race — between reading the holder PID
   * and unlinking, another process could claim the lock and our unlink would remove it.
   * This is inherent to file-based locking without OS-level flock(2). Acceptable for a
   * single-user local tool where the race window is narrow and the consequence is a
   * redundant token refresh, not data corruption.
   */
  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    mkdirSync(paths.config, { recursive: true, mode: 0o700 });

    const lockFile = paths.authLock;
    const pid = process.pid.toString();
    let lockAcquired = false;
    const deadline = Date.now() + 10_000;

    // Try to acquire lock with wall-clock deadline
    while (Date.now() < deadline) {
      try {
        writeFileSync(lockFile, pid, { flag: "wx", mode: 0o600 }); // fails if exists
        lockAcquired = true;
        break;
      } catch {
        // Lock exists — check if holder is still alive
        try {
          const holderPid = Number.parseInt(readFileSync(lockFile, "utf-8").trim(), 10);
          if (!Number.isInteger(holderPid) || holderPid <= 0) {
            // Corrupt lock file — remove unconditionally
            try {
              unlinkSync(lockFile);
            } catch {
              /* already gone */
            }
            await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));
            continue;
          }
          try {
            process.kill(holderPid, 0); // signal 0 = check if alive
            // PID alive, wait and retry with jitter
            await new Promise((r) => setTimeout(r, 100 + Math.random() * 100));
          } catch (killErr) {
            // Distinguish ESRCH (process dead) from EPERM (no permission)
            if ((killErr as NodeJS.ErrnoException).code === "ESRCH") {
              // PID dead — re-read as a best-effort check (see TOCTOU note above)
              try {
                const currentPid = Number.parseInt(readFileSync(lockFile, "utf-8"), 10);
                if (currentPid === holderPid) {
                  unlinkSync(lockFile);
                }
              } catch {
                /* lock already gone or re-claimed — retry will sort it out */
              }
              // Small delay after stale-lock cleanup to avoid tight spin if two
              // processes unlink simultaneously (see TOCTOU note above)
              await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));
            } else {
              // EPERM or other — process may be alive under different user, wait
              await new Promise((r) => setTimeout(r, 100 + Math.random() * 100));
            }
          }
        } catch {
          // Can't read lock — try again
          await new Promise((r) => setTimeout(r, 100 + Math.random() * 100));
        }
      }
    }

    if (!lockAcquired) {
      throw new Error(
        "Could not acquire auth lock after 10 seconds — another process may be refreshing tokens.",
      );
    }

    try {
      return await fn();
    } finally {
      try {
        unlinkSync(lockFile);
      } catch {
        // Already removed
      }
    }
  }
}
