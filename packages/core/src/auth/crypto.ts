/** Generate a cryptographically random hex string for OAuth CSRF state */
export function generateState(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Generate a PKCE code_verifier (RFC 7636 §4.1): 43–128 chars, base64url-encoded */
export function generateCodeVerifier(bytes = 32): string {
  if (bytes < 32 || bytes > 96) throw new Error("code_verifier bytes must be 32–96 (produces 43–128 char verifier per RFC 7636)");
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64UrlEncode(buf);
}

/** Derive code_challenge = BASE64URL(SHA-256(verifier)) (RFC 7636 §4.2) */
export async function deriveCodeChallenge(verifier: string): Promise<string> {
  if (typeof crypto?.subtle?.digest !== "function") {
    throw new Error("crypto.subtle is not available (requires secure context or Node 16+)");
  }
  const encoded = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(buf: Uint8Array): string {
  let binary = "";
  for (const b of buf) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
