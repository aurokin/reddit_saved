import { DEFAULT_REDIRECT_PORT, OAUTH_TIMEOUT_MS } from "../constants";
import { escapeHtml } from "../utils/html-escape";
import { deriveCodeChallenge } from "./crypto";
import { type OAuthPendingState, createPendingState, validateState } from "./oauth-state";
import { buildAuthorizeUrl } from "./oauth-urls";
import { TokenManager } from "./token-manager";

export interface OAuthServerOptions {
  clientId: string;
  clientSecret: string;
  port?: number;
  /** Bind address for the callback server. Defaults to REDDIT_OAUTH_HOST env var or "127.0.0.1".
   *  Set to a LAN IP (e.g. "192.168.1.50") to allow auth from other devices on the network. */
  hostname?: string;
  /** Where to redirect the browser after successful auth (e.g. http://192.168.1.50:3001) */
  returnTo?: string;
  /** Called with the authorize URL the user needs to visit */
  onAuthorizeUrl?: (url: string) => void;
  /** Called on successful authentication */
  onSuccess?: (username: string) => void;
  /** Called on error */
  onError?: (error: Error) => void;
}

export interface OAuthServerHandle {
  /** The URL the user should visit to authorize */
  authorizeUrl: string;
  /** Stop the server */
  stop: () => void;
  /** Promise that resolves when auth completes or times out */
  done: Promise<void>;
}

/**
 * Start a temporary Bun.serve() on hostname:PORT/callback to handle the OAuth redirect.
 * Used by both CLI (opens browser) and web (redirects from API route).
 * Bind address defaults to REDDIT_OAUTH_HOST env var or 127.0.0.1.
 */
export async function startOAuthServer(options: OAuthServerOptions): Promise<OAuthServerHandle> {
  const port = options.port ?? DEFAULT_REDIRECT_PORT;
  const hostname = options.hostname ?? process.env.REDDIT_OAUTH_HOST ?? "127.0.0.1";
  // Wrap IPv6 addresses in brackets for valid URI syntax (e.g. http://[::1]:9638/callback).
  // Skip if already bracketed to avoid double-wrapping.
  const isIPv6 = hostname.includes(":") && !hostname.startsWith("[");
  const uriHost = isIPv6 ? `[${hostname}]` : hostname;
  const redirectUri = `http://${uriHost}:${port}/callback`;
  const pendingStates = new Map<string, OAuthPendingState>();
  const tokenManager = new TokenManager();

  // Validate returnTo URL to prevent open redirect — allow the configured hostname
  // plus localhost variants.
  // URL.hostname always returns IPv6 addresses without brackets per WHATWG spec,
  // so the raw form is sufficient. When the caller passes an already-bracketed hostname,
  // also add the raw inner form for matching.
  const allowedHosts = new Set(["localhost", "127.0.0.1", hostname]);
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    allowedHosts.add(hostname.slice(1, -1));
  }
  if (options.returnTo) {
    let returnUrl: URL;
    try {
      returnUrl = new URL(options.returnTo);
    } catch {
      throw new Error(`returnTo is not a valid URL: ${options.returnTo}`);
    }
    if (!["http:", "https:"].includes(returnUrl.protocol)) {
      throw new Error(`returnTo must use http or https, got: ${returnUrl.protocol}`);
    }
    if (!allowedHosts.has(returnUrl.hostname)) {
      throw new Error(
        `returnTo hostname "${returnUrl.hostname}" is not in the allowed set: ${[...allowedHosts].join(", ")}`,
      );
    }
  }

  // Create CSRF state with PKCE verifier
  const pending = createPendingState(options.returnTo);
  pendingStates.set(pending.state, pending);

  // Derive PKCE S256 challenge from verifier
  const codeChallenge = await deriveCodeChallenge(pending.codeVerifier);

  const authorizeUrl = buildAuthorizeUrl({
    clientId: options.clientId,
    state: pending.state,
    codeChallenge,
    redirectUri,
  });

  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const done = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  // Guard against double resolve/reject from repeated /callback hits
  let settled = false;

  // Auto-timeout
  const timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    server.stop(false);
    const err = new Error("OAuth server timed out. Please try authenticating again.");
    options.onError?.(err);
    reject(err);
  }, OAUTH_TIMEOUT_MS);

  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      port,
      hostname,
      async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname !== "/callback") {
          return new Response("Not found", { status: 404 });
        }

        // Guard against duplicate /callback hits (browser retry, double-click)
        if (settled) {
          return new Response(
            errorPage(
              "Authorization already handled. Please close this tab and try again if needed.",
            ),
            {
              status: 400,
              headers: { "Content-Type": "text/html" },
            },
          );
        }

        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        if (error) {
          settled = true;
          clearTimeout(timeout);
          const truncatedError = error.slice(0, 256);
          const err = new Error(`Reddit authorization denied: ${truncatedError}`);
          options.onError?.(err);
          reject(err);
          const response = new Response(errorPage(truncatedError), {
            headers: { "Content-Type": "text/html" },
          });
          setTimeout(() => server.stop(false), 500);
          return response;
        }

        if (!code || !state) {
          return new Response(errorPage("Missing authorization code or state parameter."), {
            status: 400,
            headers: { "Content-Type": "text/html" },
          });
        }

        const validState = validateState(state, pendingStates);
        if (!validState) {
          return new Response(errorPage("Invalid or expired authorization state."), {
            status: 400,
            headers: { "Content-Type": "text/html" },
          });
        }

        // Claim the slot before any async work to prevent double token exchange
        settled = true;
        clearTimeout(timeout);

        try {
          const settings = await tokenManager.exchangeCode(
            code,
            options.clientId,
            options.clientSecret,
            validState.codeVerifier,
            redirectUri,
          );

          // Construct response before resolving — prevents teardown-before-redirect races
          let response: Response;
          if (validState.returnTo) {
            response = Response.redirect(validState.returnTo, 302);
          } else {
            response = new Response(successPage(settings.username), {
              headers: { "Content-Type": "text/html" },
            });
          }

          setTimeout(() => server.stop(false), 500);
          options.onSuccess?.(settings.username);
          resolve();
          return response;
        } catch (err) {
          const authError = err instanceof Error ? err : new Error(String(err));
          options.onError?.(authError);
          reject(authError);
          // Show generic message in browser; keep detail in the thrown error
          const response = new Response(errorPage("Authentication failed. Please try again."), {
            status: 500,
            headers: { "Content-Type": "text/html" },
          });
          setTimeout(() => server.stop(false), 500);
          return response;
        }
      },
    });
  } catch (err) {
    clearTimeout(timeout);
    pendingStates.clear();
    throw err;
  }

  options.onAuthorizeUrl?.(authorizeUrl);

  return {
    authorizeUrl,
    stop: () => {
      if (!settled) {
        settled = true;
        reject(new Error("OAuth flow cancelled"));
      }
      clearTimeout(timeout);
      server.stop(false);
    },
    done,
  };
}

// ============================================================================
// HTML templates — all interpolated values are escaped to prevent XSS
// ============================================================================

function successPage(username: string): string {
  return `<!DOCTYPE html><html><head><title>Authenticated</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0}
.card{text-align:center;padding:2rem;border-radius:12px;background:#16213e;box-shadow:0 4px 24px rgba(0,0,0,.3)}
h1{color:#4ade80}p{color:#94a3b8}</style></head>
<body><div class="card"><h1>Authenticated!</h1><p>Logged in as <strong>${escapeHtml(username)}</strong></p><p>You can close this tab.</p></div></body></html>`;
}

function errorPage(message: string): string {
  return `<!DOCTYPE html><html><head><title>Auth Error</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0}
.card{text-align:center;padding:2rem;border-radius:12px;background:#16213e;box-shadow:0 4px 24px rgba(0,0,0,.3)}
h1{color:#f87171}p{color:#94a3b8}</style></head>
<body><div class="card"><h1>Authentication Failed</h1><p>${escapeHtml(message)}</p><p>Please try again.</p></div></body></html>`;
}
