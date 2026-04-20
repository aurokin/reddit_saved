# ADR 0001 — Cookie-session auth via companion browser extension

**Status:** Accepted (2026-04)
**Supersedes:** the original OAuth-only design in `docs/plans/architecture.md`

## Context

The original design assumed every user could register a Reddit OAuth app
(client ID + secret) at <https://www.reddit.com/prefs/apps>. The CLI and web
flows both relied on this — `TokenManager` exchanged the auth code, refreshed
the access token, and signed every request to `oauth.reddit.com`.

In 2024 Reddit closed self-service API app creation. The "Create app" UI now
forwards new accounts to a "Responsible Builder Policy" interstitial that
points users at Devvit (Reddit's first-party app platform) instead of granting
API credentials. The author confirmed this empirically — neither the "web
app" nor the "script" app type completes; both bounce to the policy page.

This blocks new installs of this tool entirely: without a client ID/secret,
`TokenManager.exchangeCode()` has nothing to send, and there is no way for
a fresh user to authenticate.

## Alternatives considered

### A. Wait for Reddit to re-open registrations

Rejected. No public timeline; the policy page reads as a permanent shift, not
a temporary freeze. The repo would be unusable for new installs indefinitely.

### B. Migrate to Devvit

Investigated and rejected. Devvit's `RedditAPIClient` is purpose-built for
moderator/community apps. It exposes posts, comments, subreddit mod actions,
and reactions — but **does not expose the per-user `/saved`, `/upvoted`,
`/hidden`, `/submitted`, or `/commented` listings** that this tool's entire
purpose is built around. There is no path forward inside Devvit's API surface
without Reddit shipping new endpoints, which they have not signalled.

Devvit also runs apps server-side in Reddit's infrastructure — the opposite
of this tool's local-first storage model.

### C. Ship a default OAuth app's credentials

Rejected. (1) Distributing a shared client_secret in a public repo is an
immediate revocation risk; Reddit will deauthorize an app whose secret is
public. (2) Per-user rate limits would all collide on the shared client.
(3) It violates Reddit's API terms.

### D. Session-cookie pass-through via a companion browser extension *(chosen)*

The user is already logged in to reddit.com in their browser. Their browser's
cookie jar plus the `x-modhash` CSRF token is a fully-functional credential
for the same `www.reddit.com/.json` endpoints the legacy app reads. A small
WebExtension can read those cookies (with the `cookies` permission) and POST
them to the local Hono server on `http://localhost:3001/api/auth/session`.

The local app then signs requests with `Cookie:` instead of
`Authorization: Bearer …`, hits `www.reddit.com/foo.json` instead of
`oauth.reddit.com/foo`, and adds `x-modhash` to writes.

## Decision

Build option D, behind an `AuthProvider` abstraction so OAuth survives as a
fallback for users who already registered an app before the freeze.

Concretely:

1. Introduce `AuthProvider` in `@reddit-saved/core`: `ensureValid()`,
   `getAuthContext()`, `isAuthenticated()`. `getAuthContext()` returns
   `{headers, baseUrl, pathSuffix, username}` — everything an endpoint
   builder needs.
2. `TokenManager` (existing OAuth flow) and `SessionManager` (new cookie flow)
   both implement `AuthProvider`. Endpoint builders consume `AuthContext`
   and never branch on the underlying mode.
3. `web/src/api/context.ts` exposes a `CompositeAuthProvider` that prefers
   Session over OAuth. The web UI lets users disconnect either independently.
4. Ship `packages/extension/` with browser-specific MV3 manifests: the repo-root
   `manifest.json` stays Chrome-valid (`background.service_worker`), while the
   Firefox build swaps in `manifest.firefox.json` (`background.scripts`) against
   the same `background.js` cross-browser shim (`globalThis.browser ?? globalThis.chrome`).

## Consequences

### Accepted trade-offs

- **No automatic refresh**. Reddit cookies expire with the user's browser
  session ("remember me" extends to ~1 year, but the refresh-token model
  OAuth gives us is gone). The extension's 30-min heartbeat keeps the
  on-disk copy fresh while the browser is open; if the browser is closed
  for a long time, the next sync will fail with a session-expired error.
- **No `x-ratelimit-*` headers**. Reddit only returns those on
  `oauth.reddit.com`. In cookie mode the rate-limiter falls back to the
  conservative defaults baked into `RATE_LIMIT_*` constants. Acceptable
  for a personal-use tool — heavy bursts aren't a real workload.
- **Trust surface widens to the extension.** The extension reads the user's
  reddit.com session, which is equivalent to being logged in as them. The
  trust model is documented in `packages/extension/README.md`; mitigation
  is "this is your own sideloaded extension, the source is ~150 lines, read
  it before installing".
- **Firefox installs are temporary** unless the user runs Developer Edition
  with signing disabled, or signs the extension via AMO themselves. AMO
  signing is out of scope for a personal-use tool. Chrome (and Chromium
  forks) accept unpacked installs permanently via `chrome://extensions`.
- **Two on-disk credential files coexist.** `auth.json` (OAuth) and
  `session.json` (cookies) can both be present. `CompositeAuthProvider`
  always prefers session. Disconnecting the session falls back to OAuth
  if `auth.json` is present.

### Things this unblocks

- New installs work without any Reddit-side configuration.
- The CLI continues to work in OAuth mode for users who already have an
  app registered — no breaking change for them.
- The endpoint layer is now auth-mode-agnostic, which makes future auth
  experiments (e.g. proxying via a server you control) a config change
  rather than a refactor.

### Things this does *not* solve

- Reddit could change cookie names or response shapes at any time;
  `SessionManager.verify()` and the extension's `/api/me.json` parser are
  the canaries. There is no SLA on cookie auth.
- The 1000-item API ceiling on `/saved` etc. is unchanged — this is a
  Reddit-side constraint, independent of auth mode.

## References

- `packages/core/src/auth/session-manager.ts` — `SessionManager` impl
- `packages/core/src/auth/token-manager.ts` — `TokenManager` impl
- `packages/core/src/api/endpoints.ts` — auth-agnostic endpoint builders
- `packages/web/src/api/context.ts` — `CompositeAuthProvider` glue
- `packages/extension/` — companion browser extension
- Reddit "Responsible Builder Policy":
  <https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy>
