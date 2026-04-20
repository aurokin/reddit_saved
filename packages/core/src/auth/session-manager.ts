import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { AUTH_FETCH_TIMEOUT_MS, HEADER_USER_AGENT, REDDIT_BASE_URL } from "../constants";
import type {
  AuthContext,
  AuthProvider,
  SessionBlockSettings,
  SessionPayload,
  SessionSettings,
} from "../types";
import { paths } from "../utils/paths";

type SessionValidationErrorCode = "SESSION_INVALID";
const SESSION_VERIFY_CACHE_MS = 60_000;

function makeSessionValidationError(message: string, code: SessionValidationErrorCode): Error {
  const error = new Error(message) as Error & { code?: SessionValidationErrorCode };
  error.code = code;
  return error;
}

/**
 * Session-cookie auth: ingests cookies forwarded by the companion browser
 * extension and presents them as an AuthProvider so the existing API client
 * can use www.reddit.com endpoints with cookie auth instead of OAuth.
 *
 * State of mutating Reddit endpoints (e.g. /api/unsave) requires `x-modhash`
 * — we derive it via a server-side /api/me.json call during ingest and refresh
 * it during later verification so the client doesn't need to do its own
 * pre-flight on every write.
 */
export class SessionManager implements AuthProvider {
  private settings: SessionSettings | null = null;
  private verifiedAt: number | null = null;
  private verificationPromise: Promise<void> | null = null;
  private blocked: SessionBlockSettings | null = null;

  private makeSessionBlockedError(): Error & { code?: string } {
    const error = new Error(
      "Extension session sync is disabled until you reconnect from the app.",
    ) as Error & { code?: string };
    error.code = "SESSION_BLOCKED";
    return error;
  }

  /** Load session.json from disk, or null if no session is active. */
  async load(): Promise<SessionSettings | null> {
    this.blocked = await this.loadBlockedState();
    const file = Bun.file(paths.sessionFile);
    if (!(await file.exists())) return null;

    let loaded: Partial<SessionSettings>;
    try {
      loaded = (await file.json()) as Partial<SessionSettings>;
    } catch (err) {
      throw new Error(
        `session.json is corrupted or unreadable. Disconnect and reconnect via the extension. (${err})`,
      );
    }

    if (
      typeof loaded.cookieHeader !== "string" ||
      loaded.cookieHeader.length === 0 ||
      typeof loaded.userAgent !== "string" ||
      loaded.userAgent.length === 0 ||
      typeof loaded.username !== "string" ||
      loaded.username.length === 0 ||
      typeof loaded.modhash !== "string" || // empty modhash is valid (logged-in user might not have one)
      typeof loaded.capturedAt !== "number" ||
      !Number.isFinite(loaded.capturedAt)
    ) {
      throw new Error(
        "session.json is missing required fields. Disconnect and reconnect via the extension.",
      );
    }

    this.settings = loaded as SessionSettings;
    this.verifiedAt = null;
    return this.settings;
  }

  private async loadBlockedState(): Promise<SessionBlockSettings | null> {
    const file = Bun.file(paths.sessionBlockFile);
    if (!(await file.exists())) return null;

    let loaded: Partial<SessionBlockSettings>;
    try {
      loaded = (await file.json()) as Partial<SessionBlockSettings>;
    } catch (err) {
      throw new Error(`session.blocked.json is corrupted or unreadable. (${err})`);
    }

    if (
      typeof loaded.blockedAt !== "number" ||
      !Number.isFinite(loaded.blockedAt) ||
      loaded.reason !== "user-disconnected"
    ) {
      throw new Error("session.blocked.json is missing required fields.");
    }

    return loaded as SessionBlockSettings;
  }

  private async refreshBlockedState(): Promise<SessionBlockSettings | null> {
    this.blocked = await this.loadBlockedState();
    return this.blocked;
  }

  private saveBlockedState(): void {
    if (!this.blocked) throw new Error("Bug: saveBlockedState() called with no blocked state");
    mkdirSync(paths.config, { recursive: true, mode: 0o700 });
    const filePath = paths.sessionBlockFile;
    const tmp = `${filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.blocked, null, 2), { mode: 0o600 });
    renameSync(tmp, filePath);
  }

  private clearBlockedState(): void {
    try {
      unlinkSync(paths.sessionBlockFile);
    } catch {
      /* already gone */
    }
    this.blocked = null;
  }

  /** Save the current session to disk (atomic write, mode 0600). */
  private save(): void {
    if (!this.settings) throw new Error("Bug: save() called with no settings loaded");
    mkdirSync(paths.config, { recursive: true, mode: 0o700 });
    const filePath = paths.sessionFile;
    const tmp = `${filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.settings, null, 2), { mode: 0o600 });
    renameSync(tmp, filePath);
  }

  private async fetchSessionIdentity(
    cookieHeader: string,
    userAgent: string,
  ): Promise<{ username: string; modhash: string }> {
    const resp = await fetch(`${REDDIT_BASE_URL}/api/me.json`, {
      method: "GET",
      headers: {
        Cookie: cookieHeader,
        [HEADER_USER_AGENT]: userAgent,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(AUTH_FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) {
        throw makeSessionValidationError(
          `Session verification failed: HTTP ${resp.status}`,
          "SESSION_INVALID",
        );
      }
      throw new Error(`Session verification failed: HTTP ${resp.status}`);
    }
    const json = (await resp.json()) as { data?: { name?: string; modhash?: string } };
    const username = json?.data?.name;
    if (!username) {
      throw makeSessionValidationError(
        "Session is no longer authenticated to reddit.com",
        "SESSION_INVALID",
      );
    }
    return {
      username,
      modhash: json.data?.modhash ?? "",
    };
  }

  /** Ingest a payload posted by the companion extension. Validates required
   *  fields, persists, and (best-effort) verifies by hitting /api/me.json. */
  async ingest(payload: SessionPayload): Promise<SessionSettings> {
    const blocked = await this.refreshBlockedState();
    if (blocked) throw this.makeSessionBlockedError();
    if (
      !payload ||
      typeof payload.cookieHeader !== "string" ||
      payload.cookieHeader.length === 0 ||
      typeof payload.userAgent !== "string" ||
      payload.userAgent.length === 0
    ) {
      throw new Error("Invalid session payload: missing required fields");
    }
    const verified = await this.fetchSessionIdentity(payload.cookieHeader, payload.userAgent);
    if (await this.refreshBlockedState()) throw this.makeSessionBlockedError();
    this.settings = {
      cookieHeader: payload.cookieHeader,
      userAgent: payload.userAgent,
      modhash: verified.modhash,
      username: verified.username,
      capturedAt: payload.capturedAt ?? Date.now(),
    };
    this.verifiedAt = null;
    this.clearBlockedState();
    this.save();
    return this.settings;
  }

  /** Clear the session and remove session.json from disk. */
  async clear(): Promise<void> {
    try {
      unlinkSync(paths.sessionFile);
    } catch {
      /* already gone */
    }
    this.settings = null;
    this.verifiedAt = null;
    this.verificationPromise = null;
  }

  async disconnect(): Promise<void> {
    await this.clear();
    this.blocked = {
      blockedAt: Date.now(),
      reason: "user-disconnected",
    };
    this.saveBlockedState();
  }

  async reconnect(): Promise<void> {
    this.clearBlockedState();
  }

  /** Best-effort liveness check — fetches /api/me.json with the saved cookies
   *  and returns the username Reddit reports. Throws if the session is dead. */
  async verify(): Promise<string> {
    if (!this.settings) throw new Error("No session loaded");
    const currentSettings = this.settings;
    const verified = await this.fetchSessionIdentity(
      currentSettings.cookieHeader,
      currentSettings.userAgent,
    );
    if (await this.refreshBlockedState()) throw this.makeSessionBlockedError();
    if (!this.settings) {
      throw new Error("No active session. Install the companion extension.");
    }
    if (this.settings !== currentSettings) {
      return this.settings.username;
    }
    // Refresh the live session details opportunistically. Keep capturedAt as the
    // extension ingest time so the UI can report when cookies were last synced.
    this.settings = {
      ...currentSettings,
      username: verified.username,
      modhash: verified.modhash,
    };
    this.save();
    this.verifiedAt = Date.now();
    return verified.username;
  }

  // --------------------------------------------------------------------------
  // AuthProvider conformance
  // --------------------------------------------------------------------------

  async ensureValid(): Promise<void> {
    if (!this.settings) {
      const loaded = await this.load();
      if (!loaded) throw new Error("No active session. Install the companion extension.");
    }

    if (this.verifiedAt !== null && Date.now() - this.verifiedAt < SESSION_VERIFY_CACHE_MS) {
      return;
    }

    try {
      this.verificationPromise ??= (async () => {
        await this.verify();
      })().finally(() => {
        this.verificationPromise = null;
      });
      await this.verificationPromise;
    } catch (err) {
      if ((err as Error & { code?: string }).code === "SESSION_INVALID") {
        await this.clear();
      } else {
        this.verifiedAt = null;
      }
      throw err;
    }
  }

  isAuthenticated(): boolean {
    return !!this.settings?.cookieHeader && !!this.settings?.username;
  }

  isBlocked(): boolean {
    return this.blocked !== null;
  }

  async getBlockedState(): Promise<SessionBlockSettings | null> {
    if (this.blocked) return this.blocked;
    this.blocked = await this.loadBlockedState();
    return this.blocked;
  }

  getAuthContext(): AuthContext {
    if (!this.settings) {
      throw new Error("No active session. Install the companion extension.");
    }
    const headers: Record<string, string> = {
      Cookie: this.settings.cookieHeader,
      [HEADER_USER_AGENT]: this.settings.userAgent,
    };
    // x-modhash is only required for write requests (POST /api/unsave et al.),
    // but adding it to GETs is harmless — Reddit ignores it on read paths.
    if (this.settings.modhash) headers["x-modhash"] = this.settings.modhash;
    return {
      headers,
      baseUrl: REDDIT_BASE_URL,
      pathSuffix: ".json",
      username: this.settings.username,
    };
  }

  /** Snapshot of the current session state, sans the cookie header (which is
   *  effectively a credential — never expose it via API responses). */
  getSummary(): { username: string; capturedAt: number } | null {
    if (!this.settings) return null;
    return {
      username: this.settings.username,
      capturedAt: this.settings.capturedAt,
    };
  }
}
