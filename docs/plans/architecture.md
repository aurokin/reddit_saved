# Reddit Saved Architecture

## Read This First

### Product in one sentence

Reddit Saved is a local-first archive for Reddit content: fetch once, cache in
SQLite, then browse, search, tag, export, and selectively unsave against the
local database instead of repeatedly hitting Reddit's slow paginated API.

### Current repo status

- Core data model, CLI, web app, and companion extension all exist in code.
- The web build and workspace typecheck pass.
- The test surface is broad, but the full suite is not clean yet: current
  failures are concentrated in OAuth/auth persistence tests.

### Reader path

- Read this file for the system shape, invariants, and decision record.
- Read [phase-4.md](./phase-4.md) for the web implementation harness and
  current finish-line work.
- Read [packages/web/README.md](../../packages/web/README.md) for day-to-day
  web workflows.
- Read [ADR 0001](../adr/0001-cookie-session-auth.md) for the auth-mode choice.

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

## External Interfaces

### CLI surface

```text
reddit-saved auth login|status|logout
reddit-saved fetch [--full] [--type saved|upvoted|submitted|commented] [--limit N]
reddit-saved search <query> [filters...]
reddit-saved list [filters...]
reddit-saved export [--format json|csv|markdown] [filters...]
reddit-saved status
reddit-saved unsave [selectors...] [--dry-run] --confirm
reddit-saved tag list|create|rename|delete|add|remove|show
```

### Web API surface

| Area | Routes |
|---|---|
| Auth | `/api/auth/status`, `/api/auth/login`, `/api/auth/logout`, session endpoints |
| Posts | `/api/posts`, `/api/posts/search`, `/api/posts/:id`, post tag mutations |
| Tags | `/api/tags` CRUD |
| Sync | `/api/sync/status`, `/api/sync/fetch`, `/api/sync/cancel` |
| Actions | `/api/unsave`, `/api/export`, `/api/health` |

## Verification Harness

### Fast checks

```bash
bun install
bun run typecheck
bun --cwd packages/web run build
cd packages/cli && bun run src/index.ts --help
```

### Package-scoped checks

```bash
cd packages/core && bun test
cd packages/cli && bun test
cd packages/web && bun run test
```

### Current observed status

- `bun run typecheck`: passes
- `bun --cwd packages/web run build`: passes
- `cd packages/cli && bun run src/index.ts --help`: passes
- `bun test`: not clean; current failures are concentrated in:
  - `packages/core/tests/token-manager.test.ts`
  - `packages/cli/tests/auth.test.ts`

The docs should treat auth persistence and OAuth flow behavior as the main
remaining reliability hotspot, not the whole application.

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

## Appendix D: Reference Implementation Sources

- `reference/saved-reddit-exporter/src/request-queue.ts`
- `reference/saved-reddit-exporter/src/api-client.ts`
- `reference/saved-reddit-exporter/src/types.ts`
- `reference/saved-reddit-exporter/src/auth.ts`
- `reference/saved-reddit-exporter/src/filters.ts`
- `reference/saved-reddit-exporter/src/constants.ts`
