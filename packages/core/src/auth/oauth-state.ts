import { OAUTH_STATE_EXPIRY_MS } from "../constants";
import { generateCodeVerifier, generateState } from "./crypto";

export interface OAuthPendingState {
  state: string;
  codeVerifier: string;
  expiresAt: number;
  returnTo?: string;
}

/**
 * Create a new pending OAuth state with CSRF token and PKCE verifier.
 * The Map that stores these lives in the oauth-server closure, not here.
 */
export function createPendingState(returnTo?: string): OAuthPendingState {
  return {
    state: generateState(),
    codeVerifier: generateCodeVerifier(),
    expiresAt: Date.now() + OAUTH_STATE_EXPIRY_MS,
    returnTo,
  };
}

/** Validate a state token against a pending states map.
 * Checks expiry before consuming the state so expired tokens can be distinguished. */
export function validateState(
  state: string,
  pending: Map<string, OAuthPendingState>,
): OAuthPendingState | null {
  const entry = pending.get(state);
  if (!entry) return null;

  // Check expiry before deleting — if expired, still consume to prevent replay
  if (Date.now() > entry.expiresAt) {
    pending.delete(state);
    return null;
  }

  pending.delete(state);
  return entry;
}
