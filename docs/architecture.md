# Reddit Saved Architecture

## Read This First

### Product in one sentence

Reddit Saved is a local-first archive for Reddit content: fetch once, cache in
SQLite, then browse, search, tag, export, and selectively unsave against the
local database instead of repeatedly hitting Reddit's slow paginated API.

### What this doc is for

- Read this file for the stable system shape.
- Use it to understand package responsibilities and invariants.
- Do not use it as a work tracker or execution plan.

### Reader path

- Read [README.md](./README.md) for the docs hub.
- Read [harness/workspace.md](./harness/workspace.md) for repo-level
  verification.
- Read [harness/web.md](./harness/web.md) for the local web harness.
- Read [interfaces/cli.md](./interfaces/cli.md) and
  [interfaces/web-api.md](./interfaces/web-api.md) for surface reference.
- Read [adr/0001-cookie-session-auth.md](./adr/0001-cookie-session-auth.md) for
  the auth-mode decision.

## System At A Glance

### Core idea

- Reddit is the system of record for saved state.
- SQLite is the local working set and search index.
- The app treats "fetch from Reddit" and "operate locally" as separate phases.
- Tags are local-only metadata and are never synced back to Reddit.

### High-level flow

1. Authenticate with either the companion extension session flow or legacy
   OAuth.
2. Fetch Reddit listings into SQLite.
3. Search, browse, filter, export, and tag from SQLite.
4. Optionally unsave on Reddit, then mark the affected local rows as no longer
   on Reddit.

### Package map

| Package | Role | Notes |
|---|---|---|
| `packages/core` | Shared domain logic | Auth, Reddit API client, queueing, SQLite, tags, sync, export |
| `packages/cli` | Operator and automation interface | JSON-first output, human mode optional |
| `packages/web` | Local SPA + API server | React 19 + Vite frontend, Hono API on Bun |
| `packages/extension` | Browser-side session capture | Forwards reddit.com cookies and modhash to localhost |

## Design Decisions

| Decision | Choice | Why |
|---|---|---|
| Storage | SQLite via `bun:sqlite` | Single-file local state, FTS5 search, zero extra runtime deps |
| Search | FTS5 + BM25 | Fast local full-text search over archived content |
| Auth | Session cookies first, OAuth fallback | Reddit app registration is no longer broadly available |
| Sync model | Fetch to cache, then operate locally | Keeps user interactions fast and deterministic |
| Removed saves | Soft-delete with `is_on_reddit` | Avoids destructive local deletes and preserves tags/history |
| Web transport | Single-origin Bun server + SPA | Keeps auth and local-only assumptions simple |
| Progress streaming | SSE | Enough for local long-running sync feedback without extra infra |

## Package Responsibilities

### `packages/core`

- `auth/`: `SessionManager`, `TokenManager`, OAuth server/helpers
- `api/`: `RedditApiClient`, typed endpoint builders
- `queue/`: rate limiter, circuit breaker, offline queue, request queue
- `storage/`: schema, mapper, SQLite adapter, export
- `tags/`: tag CRUD and post-tag associations
- `sync/`: checkpoint persistence and orphan detection
- `filters/`: filter engine and presets

### `packages/cli`

- Hand-rolled arg parsing
- Auth commands
- Fetch, search, list, export, status, unsave
- Local tag management
- JSON output by default for agent/composable usage

### `packages/web`

- Hono API on `:3001`
- React SPA routes for home, browse, post, settings, login
- Query and SSE hooks over the local API
- Seeded test/dev database workflow
- Production mode serves both API and built SPA

### `packages/extension`

- Reads reddit.com cookies
- Captures session identity and modhash
- Posts the credential payload to the local app
- Never talks to non-local destinations besides reddit.com

## Critical Invariants

### Data and sync

- `posts` is the main working table; FTS is a derived index.
- `raw_json` is retained so the local cache can preserve the source payload.
- `is_on_reddit = 0` means "no longer confirmed on Reddit", not "delete locally".
- Full-sync orphan detection is skipped when the active local count for an
  origin reaches Reddit's 1000-item listing cap.

### Auth

- Session auth takes precedence when both `session.json` and `auth.json` exist.
- Session mode and OAuth share the same downstream `AuthContext` contract.
- `clientSecret` is intentionally not persisted back to disk.
- `TEST_MODE` must never run with `NODE_ENV=production`.

### Origin semantics

- `content_origin` records the first origin that introduced an item.
- Later sightings from another origin refresh metadata but do not rewrite
  `content_origin`.
- This is a simplification, not exact multi-origin accounting.

## Interfaces And Verification

- CLI command surface: [interfaces/cli.md](./interfaces/cli.md)
- Local web API surface: [interfaces/web-api.md](./interfaces/web-api.md)
- Workspace verification harness: [harness/workspace.md](./harness/workspace.md)
- Web verification harness: [harness/web.md](./harness/web.md)

## Known Limits

- Reddit listing endpoints expose at most 1000 items.
- OAuth callback flow is single-port and single-flight.
- Multi-origin membership is simplified to first-seen origin.
- Backup/restore is manual today.
- SSE sync progress is local/same-origin oriented and not designed for hosted,
  cross-origin deployment.

## Appendix A: Storage Model

### Main tables

- `posts`
- `posts_fts`
- `tags`
- `post_tags`
- `sync_state`
- `schema_version`

### Post row notes

- `id` is the Reddit ID without prefix
- `name` is the fullname (`t1_xxx`, `t3_xxx`)
- `kind` is `t1` or `t3`
- `is_on_reddit` tracks whether the item is still present on Reddit
- `last_seen_at` supports orphan detection
- `raw_json` stores the original Reddit payload

### Search model

- FTS indexes title, selftext, body, subreddit, author, flair, URL, and domain.
- Search joins FTS back to `posts` on `rowid`.
- Tag-filtered search uses `EXISTS` rather than a grouped join so FTS auxiliary
  functions still work correctly.

## Appendix B: Sync Model

### Two kinds of sync state

- `sync_state` table stores completed-sync metadata such as cursors and
  timestamps.
- `sync/state-manager.ts` stores in-progress checkpoint data in a JSON file for
  crash recovery.

### Incremental sync

- Uses Reddit `after` cursors.
- Updates or inserts seen items.
- Persists one resume cursor per origin.

### Full sync

- Walks the full listing window available from Reddit.
- Marks unseen local rows as orphaned only when the origin is below the 1000
  item saturation limit.

## Appendix C: Auth Model

### Session mode

- Companion extension posts cookie-derived credentials to
  `/api/auth/session`.
- Stored in `session.json` with mode `0600`.
- Requests use `www.reddit.com/.json` endpoints with cookie auth and modhash.

### OAuth mode

- Legacy path for users with a registered Reddit app.
- Tokens are stored in `auth.json`.
- `clientSecret` is kept in memory and sourced from env or the login flow.

### Mode selection

- Web uses a composite provider.
- Session wins when present.
- OAuth remains the fallback.

## Appendix D: Upstream Implementation Sources

- `reference/saved-reddit-exporter/src/request-queue.ts`
- `reference/saved-reddit-exporter/src/api-client.ts`
- `reference/saved-reddit-exporter/src/types.ts`
- `reference/saved-reddit-exporter/src/auth.ts`
- `reference/saved-reddit-exporter/src/filters.ts`
- `reference/saved-reddit-exporter/src/constants.ts`
