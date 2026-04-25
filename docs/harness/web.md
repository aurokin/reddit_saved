# Web Harness

## Purpose

This is the verification harness for the local web interface. The web package
is not a separate backend product; it is a same-machine operator surface over
the same SQLite database, auth files, and sync machinery.

## Read This First

### What this doc is for

- Use this doc to validate the web layer.
- Use it as a harness doc, not a feature wishlist.
- If a capability cannot be exercised through a concrete harness, it is not
  done enough.

### Primary outcomes

- Run the SPA and API together against a seeded database.
- Exercise browse, search, post detail, tags, exports, auth state, and sync.
- Verify production build behavior.
- Make the current proof points explicit.

## Current Observations

### What is already true

- Vite + React 19 SPA
- Hono API on `Bun.serve()`
- Shared SQLite/auth/core integration
- Browse, post detail, settings, login, and home routes
- Sync progress over SSE
- Seed script and Playwright smoke coverage

### What is still weakly proved

- Long-running sync and concurrent CLI/web usage still need more confidence than
  the current smoke coverage provides.
- Settings tag management is CRUD-oriented; tag merge is intentionally out of
  the current scope.
- Component tests currently pass but emit React `act(...)` warnings around
  BrowsePage transition updates; these warnings are not workspace harness
  blockers.

## Reader Path

- Read [../architecture.md](../architecture.md) for system shape and
  invariants.
- Read [../../packages/web/README.md](../../packages/web/README.md) for
  day-to-day commands.
- Read [../tracking.md](../tracking.md) for active hardening work.
- Use this file to answer:
  - what harnesses exist
  - what each harness proves
  - what still has weaker evidence than the rest of the package

## Web Harnesses

### 1. Seeded local harness

Purpose: prove the SPA can render meaningful state without Reddit access.

```bash
bun run --filter @reddit-saved/web seed
cd packages/web
TEST_MODE=1 bun run dev
```

This harness should validate:

- API starts against `./dev-data/reddit-saved.db`
- SPA loads on `:3000`
- Browse page shows seeded items
- Settings page can export seeded data
- No real Reddit writes occur

### 2. API harness

Purpose: prove the web server is a thin adapter over core, not a separate
domain implementation.

Routes currently in play:

- Auth: `/api/auth/status`, `/api/auth/login`, `/api/auth/logout`, session
  endpoints
- Posts: `/api/posts`, `/api/posts/search`, `/api/posts/:id`
- Tags: `/api/tags`, `/api/posts/:id/tags`
- Sync: `/api/sync/status`, `/api/sync/fetch`, `/api/sync/cancel`
- Actions: `/api/unsave`, `/api/export`, `/api/health`

The harness passes when the API is thin, same-origin, and backed by shared core
objects from `src/api/context.ts`.

### 3. UI harness

Purpose: prove the SPA is a usable local operator surface, not just connected
components.

Route expectations:

| Route | Job |
|---|---|
| `/` | high-level status, recent items, tag links |
| `/browse` | filter, search, paginate, virtualized list |
| `/post/:id` | detail view, media, tags, confirm-gated unsave |
| `/settings` | auth state, sync state, exports, tag management |
| `/login` | auth handoff and reconnect entry point |

### 4. Sync harness

Purpose: prove the web can drive and observe long-running fetch work.

What to validate:

- `GET /api/sync/fetch` streams progress via SSE
- cancel path aborts cleanly
- checkpoint recovery works across interrupted runs
- sync status reflects current DB state

What is still weak:

- sustained long-run behavior
- concurrent CLI + web sync pressure
- SSE behavior under heavier backpressure than smoke tests cover

### 5. Production harness

Purpose: prove the package can ship as a single-process local web app.

```bash
cd packages/web
bun run build
bun run start
```

The harness passes when:

- `dist/` builds successfully
- the server serves both API and static assets
- non-`/api/*` routes fall back to `dist/index.html`
- `TEST_MODE` is rejected under `NODE_ENV=production`

### 6. Test harness

Purpose: keep the web package change-safe.

Current layers:

- component tests under `packages/web/tests`
- API route tests under `packages/web/tests`
- Playwright smoke test under `packages/web/tests-e2e`

Recommended routine:

```bash
cd packages/web
bun run typecheck
bun run test
bun run test:e2e
```

Current repo reality:

- package-level typecheck is clean
- web build is clean
- full workspace `bun test` is clean
- package-script tests pass through `bun run --filter '*' test`

## Ready Signal

Treat the web package as fully proved for the current scope when all of the
following are true:

- Seeded local workflow is stable and documented.
- Web build and start flow work consistently.
- Browse, search, post detail, export, tag CRUD, and sync are covered by
  package-level tests or smoke tests.
- Auth mode behavior is reliable enough that it no longer dominates test
  failures.
- Remaining limitations are architectural tradeoffs, not regressions or
  half-built flows.

## Risks

- Reddit still caps listing endpoints at 1000 items.
- OAuth remains single-port and single-flight.
- The app is intentionally single-origin and local-first; cross-origin hosting
  would require a different sync/auth transport story.
- `content_origin` remains a simplification rather than exact multi-origin
  membership.

## Verification Snapshot

At the current repo snapshot:

- `bun run typecheck`: passes
- `bun test`: passes at the workspace root
- `bun run --filter @reddit-saved/web build`: passes
