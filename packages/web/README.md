# @reddit-saved/web

## Read This First

This package is the local web UI for Reddit Saved. It is not a hosted service:
the React app and the Hono API run on your machine, talk to the same SQLite
database as the CLI, and share the same auth files.

If you need system shape or current implementation status, read:

- [Architecture](../../docs/plans/architecture.md)
- [Phase 4 harness](../../docs/plans/phase-4.md)

## Quickstart

From the repo root:

```bash
bun install
bun run --filter @reddit-saved/web seed
cd packages/web
TEST_MODE=1 bun run dev
```

Then open `http://localhost:3000`.

What this does:

- seeds `./dev-data/reddit-saved.db` with deterministic fixture data
- starts the API on `:3001`
- starts Vite on `:3000`
- keeps Reddit writes and real OAuth disabled

## Daily Workflows

### Start local dev

```bash
cd packages/web
TEST_MODE=1 bun run dev
```

### Reseed fixture data

```bash
bun run --filter @reddit-saved/web seed
```

### Run the API only

```bash
cd packages/web
bun run dev:server
```

### Build and serve production mode

```bash
cd packages/web
bun run build
bun run start
```

### Typecheck and test

```bash
cd packages/web
bun run typecheck
bun run test
bun run test:e2e
```

## What The Package Contains

| Area | Purpose |
|---|---|
| `src/api/` | Hono server, middleware, shared app context, API routes |
| `src/pages/` | Route-level UI for home, browse, post, settings, login |
| `src/components/` | Shared UI components and local primitives |
| `src/hooks/queries.ts` | React Query hooks and sync stream wiring |
| `scripts/seed.ts` | Deterministic local data harness |
| `tests/` | component and route tests |
| `tests-e2e/` | Playwright smoke coverage |

## Auth Modes

### Default: companion extension session

Recommended for new users.

- Install the unpacked extension from `packages/extension`
- The extension forwards reddit.com cookies and modhash to
  `/api/auth/session`
- The server stores session state in `session.json`
- API calls use cookie-mode auth against `www.reddit.com/.json`

### Legacy: OAuth

Available for users who already have a registered Reddit app.

- Set `REDDIT_CLIENT_ID`
- Set `REDDIT_CLIENT_SECRET`
- Start the flow from `/login`
- Tokens are stored in `auth.json`

### Auth precedence

If both auth files exist, session mode wins.

## TEST_MODE

`TEST_MODE=1` is the main local harness.

It does all of the following:

- disables Reddit writes
- stubs OAuth login behavior
- keeps sync and unsave from touching Reddit
- lets Playwright and local dev run against seeded data

It is a hard error to run this mode with `NODE_ENV=production`.

## Operational Notes

### Routing

- Vite dev server proxies `/api/*` to `:3001`
- production mode serves both API and SPA from `:3001`
- non-`/api/*` routes fall back to `dist/index.html`

### Sync progress

- sync progress uses SSE
- the client subscribes with `EventSource`
- cancel goes through `/api/sync/cancel`

### Data model

- web and CLI share the same SQLite database
- tags are local-only
- orphaned rows stay searchable and exportable

## Troubleshooting

### Page loads but there is no data

Reseed and restart:

```bash
bun run --filter @reddit-saved/web seed
cd packages/web
TEST_MODE=1 bun run dev
```

### Build works but `start` cannot serve the app

Make sure `dist/` exists:

```bash
cd packages/web
bun run build
bun run start
```

### Sync refuses to run

Expected in `TEST_MODE`. That mode is for local UI/test harnesses, not real
Reddit fetches.

### Login looks disconnected

Check which auth path you intend to use:

- extension session flow for normal local usage
- OAuth only if you already have Reddit app credentials

### Media previews are blocked

The server applies a CSP allowlist for Reddit media hosts. If you add new media
sources, update the middleware CSP configuration.

## Scripts

| Script | Purpose |
|---|---|
| `bun run dev` | API + Vite against `./dev-data/reddit-saved.db` |
| `bun run dev:server` | API only |
| `bun run dev:server:test` | API only in `TEST_MODE` |
| `bun run build` | Vite production build |
| `bun run start` | Serve built SPA + API |
| `bun run seed` | Recreate deterministic fixture DB |
| `bun run test` | package tests |
| `bun run test:e2e` | Playwright smoke suite |
| `bun run typecheck` | `tsc --noEmit` |
