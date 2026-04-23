# Phase 4: Web Harness

## Purpose

Phase 4 is the local web interface for the existing core + CLI stack. The web
package is not a separate backend product; it is a same-machine operator
surface over the same SQLite database, auth files, and sync machinery.

## Read This First

### What this doc is for

- Use this doc to validate and finish the web layer.
- Use it as a harness doc, not a feature wishlist.
- If a capability cannot be exercised through a concrete harness, it is not
  done enough.

### Primary outcomes

- Run the SPA and API together against a seeded database.
- Exercise browse, search, post detail, tags, exports, auth state, and sync.
- Verify production build behavior.
- Track remaining gaps and failure hotspots.

## Current Status

### Implemented

- Vite + React 19 SPA
- Hono API on `Bun.serve()`
- Shared SQLite/auth/core integration
- Browse, post detail, settings, login, and home routes
- Sync progress over SSE
- Seed script and Playwright smoke coverage

### Still not fully closed

- Full workspace test suite is not clean; current failures cluster around auth
  persistence and OAuth behavior.
- Some plan-era items were simplified in implementation:
  - Settings tag management is CRUD-oriented; tag merge is not present.
  - The original plan assumed broader `useSuspenseQuery` usage than the current
    codebase actually employs.
- Long-running sync and concurrent CLI/web usage still need more confidence than
  the current smoke coverage provides.

## Reader Path

- Read [architecture.md](./architecture.md) for system shape and invariants.
- Read [packages/web/README.md](../../packages/web/README.md) for day-to-day
  commands.
- Use this file to answer:
  - what harnesses exist
  - what each harness proves
  - what still blocks a "done" call

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
- full workspace `bun test` is blocked by auth-related failures outside and
  alongside the web package

## Exit Criteria

Call Phase 4 done when all of the following are true:

- Seeded local workflow is stable and documented.
- Web build and start flow work consistently.
- Browse, search, post detail, export, tag CRUD, and sync are covered by
  package-level tests or smoke tests.
- Auth mode behavior is reliable enough that it no longer dominates test
  failures.
- Remaining limitations are architectural tradeoffs, not regressions or
  half-built flows.

## Remaining Work

### P0 reliability

- Fix `TokenManager` test regressions.
- Fix CLI auth tests that depend on the same persistence behavior.
- Re-run the full workspace suite until auth is no longer the primary blocker.

### P1 confidence

- Broaden end-to-end coverage for sync start/cancel/complete flows.
- Add stronger concurrent CLI/web verification around shared SQLite and auth
  files.
- Tighten README instructions so operator workflows match the actual harnesses.

### P2 optional polish

- Add tag merge if it is still a real product requirement.
- Revisit route-level loading strategy if the current query-based approach
  becomes hard to reason about.
- Add backup/restore only if it becomes a real operator need.

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
- `bun --cwd packages/web run build`: passes
- `bun test`: fails in auth-focused suites, not across the whole product

That means the web layer should be treated as feature-complete enough to finish,
but not yet stable enough to call fully hardened.
