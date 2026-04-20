import { SessionManager, TokenManager } from "@reddit-saved/core";

export type AuthMode = "session" | "oauth";

export function usernamesMatch(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export async function canFallbackToOAuth(
  token: TokenManager,
  sessionUsername: string | null,
  err: unknown,
): Promise<boolean> {
  if (!sessionUsername) return false;
  try {
    const oauthUsername = await token.getPersistedUsername();
    return !!oauthUsername && usernamesMatch(sessionUsername, oauthUsername);
  } catch {
    return false;
  }
}

export async function selectAuthMode(
  session: SessionManager,
  token: TokenManager,
  options: { sessionUsernameHint?: string | null } = {},
): Promise<AuthMode> {
  if (!session.isAuthenticated()) {
    // Best-effort load — missing/corrupt session.json is normal for OAuth users.
    try {
      await session.load();
    } catch {
      /* fall through to token below */
    }
  }

  if (session.isAuthenticated()) {
    const sessionUsername = session.getSummary()?.username ?? options.sessionUsernameHint ?? null;
    try {
      await session.ensureValid();
      return "session";
    } catch (err) {
      const sessionError = err instanceof Error ? err : new Error(String(err));
      if (!(await canFallbackToOAuth(token, sessionUsername, err))) {
        throw sessionError;
      }
      try {
        await token.ensureValid();
        const oauthUsername = token.getSettings().username;
        if (!sessionUsername || !usernamesMatch(sessionUsername, oauthUsername)) {
          throw sessionError;
        }
        return "oauth";
      } catch {
        throw sessionError;
      }
    }
  }

  await token.ensureValid();
  return "oauth";
}
