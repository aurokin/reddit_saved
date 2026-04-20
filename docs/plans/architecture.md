# Reddit Saved — Bun/TypeScript Monorepo

## Context

We analyzed 9 GitHub projects for managing Reddit saved posts. **saved-reddit-exporter** (Obsidian plugin, 99 commits) has the most production-grade Reddit API layer: circuit breaker, token bucket rate limiting, exponential backoff, resumable pagination, and offline queue. We're using it as a reference to build a new standalone tool with a production-focused CLI first, plus a planned React web app.

**Core feature**: Local full-text search over Reddit saved posts. Reddit's API is paginated and slow — we fetch once, cache locally in SQLite, and all search/browse/filter operations are instant against the local DB. Incremental sync keeps the cache fresh. Custom tags (not a Reddit feature) let users organize and group posts beyond what Reddit provides.

## Architecture: Bun Workspaces Monorepo

```
reddit-saved/
├── package.json                       # Bun workspaces root
├── bunfig.toml
├── tsconfig.json                      # Base config (strict, paths)
├── biome.json                         # Linter/formatter
│
├── packages/
│   ├── core/                          # @reddit-saved/core (zero npm deps)
│   │   ├── src/
│   │   │   ├── index.ts               # Barrel export
│   │   │   ├── types.ts               # Reddit types (ported from reference types.ts)
│   │   │   ├── constants.ts           # OAuth URLs, rate limits, API constraints
│   │   │   ├── auth/
│   │   │   │   ├── token-manager.ts   # Token exchange, refresh, validation, file-lock
│   │   │   │   ├── oauth-urls.ts      # URL builders for authorize/token endpoints
│   │   │   │   ├── oauth-state.ts     # CSRF state helpers: generate, validate, OAuthPendingState type (state Map lives in server closure)
│   │   │   │   ├── oauth-server.ts   # Bun.serve() OAuth callback on localhost:9638 (shared by CLI + web)
│   │   │   │   └── crypto.ts          # Random hex token gen (direct port)
│   │   │   ├── api/
│   │   │   │   ├── client.ts          # RedditApiClient (native fetch, no Obsidian)
│   │   │   │   └── endpoints.ts       # Typed endpoint builders
│   │   │   ├── queue/
│   │   │   │   ├── circuit-breaker.ts # Direct port (lines 84-185 of ref)
│   │   │   │   ├── rate-limiter.ts    # Direct port: token bucket 60/60s
│   │   │   │   ├── offline-queue.ts   # Direct port: priority queue, max 100
│   │   │   │   └── request-queue.ts   # Orchestrator: fetch() instead of requestUrl()
│   │   │   ├── filters/
│   │   │   │   ├── engine.ts          # FilterEngine (direct port, zero coupling)
│   │   │   │   └── presets.ts         # Filter presets (direct port)
│   │   │   ├── tags/
│   │   │   │   └── tag-manager.ts     # CRUD for tags + post-tag associations
│   │   │   ├── storage/
│   │   │   │   ├── sqlite-adapter.ts  # bun:sqlite with FTS5
│   │   │   │   ├── mapper.ts          # mapRedditItemToRow: RedditItem → PostRow
│   │   │   │   ├── schema.ts          # DDL + migrations
│   │   │   │   └── json-export.ts     # JSON/CSV/Markdown export
│   │   │   ├── sync/
│   │   │   │   ├── state-manager.ts   # Checkpoint persistence (Bun.file/Bun.write)
│   │   │   │   └── diff.ts            # Sync diff logic
│   │   │   ├── monitor/
│   │   │   │   └── performance.ts     # Request metrics (process.memoryUsage.rss)
│   │   │   └── utils/
│   │   │       ├── paths.ts           # Platform-aware config/data dirs (XDG, macOS, Windows)
│   │   │       ├── html-escape.ts     # Direct port
│   │   │       └── file-sanitizer.ts  # Direct port
│   │   └── tests/
│   │
│   ├── cli/                           # @reddit-saved/cli (zero npm deps)
│   │   ├── src/
│   │   │   ├── index.ts               # Entry: arg parser, command dispatch
│   │   │   ├── args.ts                # Hand-rolled arg parser + flag helpers
│   │   │   ├── context.ts             # Shared command bootstrap (storage/auth/api)
│   │   │   ├── output.ts              # JSON/table/progress formatters
│   │   │   ├── auth/                  # login (uses core oauth-server), status, logout
│   │   │   └── commands/              # fetch, search, list, export, status, unsave, tag
│   │   └── tests/
│   │
│   └── web/                           # @reddit-saved/web (SPA + API)
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── index.html                 # SPA entry (inline dark-mode FOUC script)
│       ├── components.json            # shadcn config
│       ├── playwright.config.ts
│       ├── bunfig.toml                # test preload for happy-dom
│       ├── scripts/seed.ts            # 200-item deterministic fixture
│       ├── src/
│       │   ├── main.tsx               # React root + QueryClient + Router
│       │   ├── router.tsx             # TanStack Router (code-based, search-schema)
│       │   ├── styles/globals.css     # Tailwind v4 + tokens
│       │   ├── api/                   # Hono on Bun.serve()
│       │   │   ├── server.ts
│       │   │   ├── context.ts         # Singleton core bootstrap (storage/tags/oauth/client)
│       │   │   ├── middleware.ts      # CSP, logger, error handler
│       │   │   └── routes/            # auth, posts, tags, sync (SSE), export
│       │   ├── pages/                 # RootLayout + Home/Browse/Post/Settings/Login
│       │   ├── components/            # PostCard, PostList, FilterPanel, SyncStatus, etc.
│       │   ├── components/ui/         # shadcn primitives (hand-rolled)
│       │   ├── hooks/queries.ts       # React Query + SSE hooks
│       │   ├── lib/                   # api-client, query-client, utils
│       │   └── types.ts               # Re-export core + web DTOs
│       └── tests/                     # bun test + happy-dom + @testing-library
│           └── e2e/                   # Playwright smoke tests
```

## Key Design Decisions

| Decision | Choice | Why |
|---|---|---|
| Storage | SQLite via `bun:sqlite` | Zero deps, FTS5 for search, single-file portable |
| Search | FTS5 with `porter unicode61` tokenizer, BM25 ranking | Covers title/selftext/body/subreddit/author. Tag-filtered search is implemented with tag subqueries/`EXISTS` to avoid FTS5 auxiliary-function constraints. Sufficient for <=1000 items |
| Auth | Two interchangeable providers behind a common `AuthProvider` interface: (1) **session-cookie pass-through** via the companion browser extension (default) — `SessionManager` ingests cookies + `x-modhash` POSTed to `/api/auth/session` and presents them as `Cookie`-mode auth on `www.reddit.com/.json`; (2) **OAuth** via `TokenManager` for users with a registered Reddit app, on `oauth.reddit.com`. A `CompositeAuthProvider` in `web/src/api/context.ts` picks Session first, OAuth fallback. Endpoints (`api/endpoints.ts`) consume an `AuthContext` and never branch on the underlying mode. | See [ADR 0001](../adr/0001-cookie-session-auth.md) for the full rationale: Reddit closed self-service app registration in 2024, Devvit lacks the per-user listing endpoints this tool needs, and a sideloaded extension is the cheapest way to give new installs a working credential. OAuth is kept for legacy users. |
| CLI output | JSON to stdout (default), `--human` flag for tables | Agent-first, composable with jq/pipes. Errors to stderr |
| Web | React 19 SPA (Vite) + Hono on Bun.serve() API on :3001 | TanStack Router (code-based) + TanStack Query + TanStack Virtual; Tailwind v4 + shadcn/ui (hand-rolled to avoid npx network calls); SSE for sync progress so `EventSource` can stream it; `TEST_MODE` env disables Reddit writes and OAuth for local dev/Playwright |
| Config/data paths | Platform-aware: Linux `$XDG_CONFIG_HOME` / `$XDG_DATA_HOME` (fallback `~/.config`, `~/.local/share`), macOS `~/Library/Application Support`, Windows `%APPDATA%`. Subdirectory: `reddit-saved/` | Cross-platform via a `paths.ts` utility in core |
| Formatter | Biome | Faster than ESLint+Prettier, single tool |
| Tags | Custom tags in SQLite (local-only, not synced to Reddit) | Reddit API has no tag/label support; local tags enable user-defined grouping and filtering |
| Removed saves | Soft-delete via `is_on_reddit` flag; detected on full sync **only when local count < 1000** | Reddit's API returns max 1000 items. If local DB has >=1000 items, orphan detection is skipped with a warning — older items beyond the API window would be falsely flagged. This is a known Reddit API limitation to revisit later |
| Unsave | `unsave` command requires `--confirm` flag | Irreversible destructive action — no undo on Reddit's side |
| Core npm deps | Zero | bun:sqlite, native fetch, Bun.file/write, Web Crypto only |

## What Gets Ported vs. Written Fresh

### Direct port (pure logic, no Obsidian coupling)
- `CircuitBreaker`, `RateLimiter` from `request-queue.ts`
- `FilterEngine` + `FILTER_PRESETS` from `filters.ts`
- `crypto-utils.ts`, `html-escape.ts`, `file-sanitizer.ts`
- Reddit data types from `types.ts` (RedditItem, RedditItemData, RedditListingResponse, FilterSettings, etc.)
- Constants from `constants.ts` (OAuth URLs, rate limits, page sizes)

### Moderate rewrite (replace Obsidian APIs)
- `RequestQueue` + `OfflineQueue` — `requestUrl()` → native `fetch()` with `AbortSignal.timeout()` for true cancellation (reference only races a timer, never cancels the socket). `RequestUrlParam` → standard `RequestInit`-based type. Thread `AbortSignal` through to `fetch({ signal })` instead of polling `signal.aborted`.
- `RedditApiClient` — `requestUrl()` → `fetch()`, `Notice` → event callbacks. **Critical**: all header access must use `response.headers.get('x-ratelimit-remaining')` (Headers API), not bracket notation `response.headers['...']` which returns undefined on native fetch.
- `RedditAuth` → `TokenManager` — extract token exchange/refresh only, drop Modal/Plugin/Protocol handler. Add file-lock for concurrent refresh safety.
- `ImportStateManager` — vault adapter → `Bun.file()`/`Bun.write()`
- `PerformanceMonitor` — Chrome memory API → `process.memoryUsage.rss()` (Bun supports this subset)

### Written fresh
- SQLite storage layer (schema, adapter, FTS5 triggers, migrations)
- Tag system (tag-manager.ts — CRUD, post-tag associations, tag-filtered search)
- Entire CLI (arg parsing, commands, output formatting, OAuth server)
- Web SPA + API server (Hono on Bun.serve, React 19 + Vite, TanStack Router/Query/Virtual, Tailwind v4, hand-rolled shadcn primitives)

## SQLite Schema

```sql
-- Connection pragmas (set on every db open in sqlite-adapter.ts)
PRAGMA journal_mode = WAL;          -- concurrent readers + single writer without SQLITE_BUSY
PRAGMA busy_timeout = 5000;         -- wait up to 5s if DB is locked
PRAGMA foreign_keys = ON;           -- required for ON DELETE CASCADE on post_tags

-- Core posts table
CREATE TABLE posts (
    id TEXT PRIMARY KEY,           -- Reddit ID (no prefix)
    name TEXT NOT NULL UNIQUE,     -- Fullname (t3_xxx / t1_xxx)
    kind TEXT NOT NULL,            -- 't1' or 't3'
    content_origin TEXT NOT NULL DEFAULT 'saved',
    title TEXT, author TEXT NOT NULL, subreddit TEXT NOT NULL,
    permalink TEXT NOT NULL, url TEXT, domain TEXT,
    selftext TEXT, body TEXT,
    score INTEGER NOT NULL DEFAULT 0, created_utc INTEGER NOT NULL,
    num_comments INTEGER, upvote_ratio REAL,
    is_self INTEGER, over_18 INTEGER DEFAULT 0,
    is_video INTEGER DEFAULT 0, is_gallery INTEGER DEFAULT 0,
    post_hint TEXT, link_flair_text TEXT,
    thumbnail TEXT,                -- thumbnail URL (avoids parsing raw_json for post cards)
    preview_url TEXT,              -- highest-res preview image URL

    -- Comment-specific fields (NULL for posts)
    parent_id TEXT,                -- fullname of parent comment/post (t1_xxx or t3_xxx)
    link_id TEXT,                  -- fullname of parent post (t3_xxx)
    link_title TEXT,               -- parent post title (for displaying comment context)
    link_permalink TEXT,           -- parent post permalink
    is_submitter INTEGER DEFAULT 0, -- 1 if comment author is the post OP

    -- Status flags
    distinguished TEXT,            -- 'moderator', 'admin', or NULL
    edited INTEGER DEFAULT NULL,   -- 0/1/timestamp depending on Reddit payload normalization
    stickied INTEGER DEFAULT 0,
    spoiler INTEGER DEFAULT 0,
    locked INTEGER DEFAULT 0,
    archived INTEGER DEFAULT 0,
    fetched_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    is_on_reddit INTEGER NOT NULL DEFAULT 1,  -- 0 = unsaved/removed on Reddit
    last_seen_at INTEGER NOT NULL,             -- last sync where Reddit still had it
    raw_json TEXT NOT NULL
);

-- Full-text search index
CREATE VIRTUAL TABLE posts_fts USING fts5(
    title, selftext, body, subreddit, author, link_flair_text, url, domain,
    content='posts', content_rowid='rowid', tokenize='porter unicode61'
);
-- + insert/update/delete triggers to keep FTS in sync
-- + indexes on subreddit, author, created_utc, score, kind, content_origin

-- Custom tags (user-defined, not from Reddit)
CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK(length(trim(name)) > 0),
    color TEXT,                    -- optional hex color for UI (#ff6b6b)
    created_at INTEGER NOT NULL
);

CREATE TABLE post_tags (
    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (post_id, tag_id)
);
CREATE INDEX idx_post_tags_tag ON post_tags(tag_id);

-- Sync state tracking
CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
-- Keys used today: last_cursor_saved, last_cursor_upvoted, last_cursor_submitted,
-- last_cursor_commented, last_sync_time, last_full_sync_time

CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
```

### Sync & removal detection

- **Incremental sync** (`reddit-saved fetch`): Uses cursor-based pagination (`after` param). New items are inserted, existing items are updated (score, num_comments, etc.). `last_seen_at` is updated for every item seen. The CLI persists one resume cursor per origin (`saved`, `upvoted`, `submitted`, `commented`) so a later rerun can continue where the prior incremental fetch stopped. In-progress checkpoint files still take precedence for crash recovery mid-run.
- **Full sync** (`reddit-saved fetch --full`): Fetches all saved items from Reddit. Orphan detection runs **only if local item count < 1000**. If >=1000 items exist locally, orphan detection is skipped and a warning is printed: "Reddit's API limits results to 1000 items. Orphan detection skipped — older items beyond this window cannot be verified." When orphan detection runs: any local item whose `last_seen_at` is older than the sync start time is marked `is_on_reddit = 0`. These items remain searchable — never deleted automatically.
- **User can choose**: `reddit-saved status` shows orphaned count. `reddit-saved search --orphaned` finds them. They keep their tags and remain in FTS.

### StorageAdapter interface

`types.ts` defines the contract. `SqliteAdapter` implements it. `TagManager` takes the same `Database` handle but has its own API — it's not behind `StorageAdapter`.

```typescript
interface StorageAdapter {
  // Posts
  upsertPosts(items: RedditItem[], origin: ContentOrigin): void;  // bulk upsert in transaction
  getPost(id: string): PostRow | null;
  listPosts(opts: ListOptions): PostRow[];         // filter, sort, paginate
  searchPosts(query: string, opts: SearchOptions): SearchResult[];  // FTS5
  markOrphaned(olderThan: number, origin?: ContentOrigin): number; // olderThan is epoch ms; optional origin scope
  getStats(): DbStats;                              // totals, subreddit counts, etc.

  // Sync state (key-value for completed-sync metadata)
  getSyncState(key: string): string | null;
  setSyncState(key: string, value: string): void;

  // Unsave
  markUnsaved(ids: string[]): void;                 // set is_on_reddit=0 for specific posts

  // Maintenance
  rebuildFtsIndex(): void;
  assertFts5Available(): void;                      // startup check

  // Lifecycle
  close(): void;
}
```

`TagManager` takes `Database` directly. Note: `StorageAdapter` reads (but never writes) tag tables for filtered queries (e.g., `searchPosts` with `--tag` JOINs `post_tags`/`tags`). `TagManager` owns all tag writes.
```typescript
class TagManager {
  constructor(db: Database);
  createTag(name: string, color?: string): Tag;
  renameTag(oldName: string, newName: string): void;
  deleteTag(name: string): void;
  addTagToPost(tagName: string, postId: string): void;  // INSERT OR IGNORE (no-op if exists)
  removeTagFromPost(tagName: string, postId: string): void;
  getTagsForPost(postId: string): Tag[];
  getPostsByTag(tagName: string): PostRow[];
  listTags(): TagWithCount[];
}
```

### RedditItem → SQL mapping

`storage/mapper.ts` (co-located with sqlite-adapter) provides:
```typescript
function mapRedditItemToRow(item: RedditItem, origin: ContentOrigin): PostRow;
```
This extracts flat fields from `item.data`, plus:
- `preview_url` from `item.data.preview?.images?.[0]?.source?.url` (decode HTML entities in URL)
- `thumbnail` from `item.data.thumbnail` (skip "self", "default", "nsfw" sentinel values)
- `raw_json` as `JSON.stringify(item)`
- `fetched_at`, `updated_at`, `last_seen_at` as `Date.now()`

The `upsertPosts` method in `SqliteAdapter` calls this mapper for each item.

### API client event callbacks

`RedditApiClient` constructor accepts a typed callback bag (no EventEmitter, no deps):
```typescript
interface ApiClientCallbacks {
  onProgress?: (fetched: number, total: number | null) => void;
  onRateLimit?: (waitMs: number, remaining: number) => void;
  onError?: (error: Error, retryable: boolean) => void;
  onPageFetched?: (pageNum: number, itemCount: number, cursor: string) => void;
}
```
CLI implements these to write progress to stderr. The planned web layer can reuse the same callback bag later.

### Sync state vs sync_state table

These serve different purposes:
- **`sync_state` SQL table**: Stores completed-sync metadata (key-value pairs like `last_cursor_saved`, `last_cursor_upvoted`, `last_cursor_submitted`, `last_cursor_commented`, `last_sync_time`, `last_full_sync_time`). Persistent across sessions. Managed via `StorageAdapter.getSyncState/setSyncState/deleteSyncState`.
- **`sync/state-manager.ts`**: Stores in-flight checkpoint data for crash recovery during a fetch (pending item IDs, failed items, current phase). Ported from `ImportStateManager`. Written to a JSON file (`.reddit-import-checkpoint.json` in data dir). **Deleted on successful completion** — only exists while a fetch is in progress.

### User-Agent

Defined as a template in `constants.ts`, constructed at runtime in `api/client.ts`:
```typescript
// constants.ts
export const USER_AGENT_TEMPLATE = 'bun:reddit-saved:v{version} (by /u/{username})';

// client.ts constructor
this.userAgent = USER_AGENT_TEMPLATE
  .replace('{version}', VERSION)
  .replace('{username}', settings.username);
```

### RedditApiClient methods

`api/client.ts` exposes these methods (all use `RequestQueue` internally):

```typescript
class RedditApiClient {
  constructor(tokenProvider: TokenProvider, requestQueue: RequestQueue, callbacks?: ApiClientCallbacks, baseUrl?: string);

  // Fetch endpoints — return RedditItem[]
  fetchSaved(opts?: FetchOptions): Promise<FetchResult>;
  fetchUpvoted(opts?: FetchOptions): Promise<FetchResult>;
  fetchUserPosts(opts?: FetchOptions): Promise<FetchResult>;
  fetchUserComments(opts?: FetchOptions): Promise<FetchResult>;

  // Comment reads
  fetchPostComments(permalink: string, threshold?: number, sort?: CommentSortOrder, signal?: AbortSignal): Promise<RedditComment[]>;
  fetchCommentWithContext(commentPermalink: string, contextDepth?: number, signal?: AbortSignal): Promise<RedditItemData | null>;
  fetchCommentReplies(commentPermalink: string, maxDepth?: number, signal?: AbortSignal): Promise<RedditItemData[]>;
  fetchCommentThread(postPermalink: string, signal?: AbortSignal): Promise<CommentThread | null>;

  // Actions
  unsaveItem(fullname: string): Promise<void>;        // POST /api/unsave
  unsaveItems(fullnames: string[]): Promise<UnsaveResult>; // batch with per-item result tracking

  // Auth
  fetchUsername(): Promise<string>;                     // GET /api/v1/me

  // Control
  pause(): void;
  resume(): void;
}

// Types used by the API client
interface FetchOptions {
  startCursor?: string;           // resume from this pagination cursor
  limit?: number;                 // max items to fetch (default: 1000)
  signal?: AbortSignal;           // for cancellation
}

interface FetchResult {
  items: RedditItem[];
  cursor: string | null;          // 'after' value for resuming
  hasMore: boolean;
  wasCancelled: boolean;
}
```

`api/endpoints.ts` builds typed URL + params for each Reddit API endpoint (`/user/{username}/saved`, `/api/unsave`, `/api/v1/me`, etc.).

### List query pattern

```sql
-- List with filters + sort (no FTS)
SELECT p.*, GROUP_CONCAT(t.name) AS tags
FROM posts p
LEFT JOIN post_tags pt ON pt.post_id = p.id
LEFT JOIN tags t ON t.id = pt.tag_id
WHERE p.is_on_reddit = 1              -- exclude orphaned unless --orphaned
  AND p.subreddit = ?                 -- optional
  AND p.author = ?                    -- optional
GROUP BY p.id
ORDER BY p.created_utc DESC           -- --sort created (default)
      -- OR p.score DESC              -- --sort score
LIMIT ? OFFSET ?;
```

### Content origin and deduplication

A post can appear in multiple endpoints (e.g., saved AND upvoted). The `content_origin` column tracks how the item was *first* fetched. If the same item appears via a different `--type` fetch, we update metadata (score, etc.) but **do not overwrite** `content_origin` — the upsert SQL omits `content_origin` from the `ON CONFLICT ... DO UPDATE SET` clause, preserving the original value. The `raw_json` is always updated to the latest version.

This is an intentional Phase 3 simplification, but it has an important consequence: origin-scoped stats and orphan detection are exact only for the first-seen origin. If an item is first fetched via `saved` and later appears in `upvoted`, a full `--type upvoted --full` sync will refresh the row's metadata and `last_seen_at`, but the row will still count as `saved` for `activeCountByOrigin` and for origin-scoped orphan cleanup. Future: add a `content_origins` junction table (or equivalent multi-origin membership model) if origin-accurate sync accounting becomes important.

### FTS bulk insert strategy

During `fetch`, all inserts happen inside a single SQLite transaction. For bulk operations:
1. `DROP TRIGGER` the three FTS sync triggers (posts_ai, posts_ad, posts_au)
2. Wrap all inserts in `db.transaction(() => { ... })` (bun:sqlite's preferred API)
3. Insert/upsert into `posts` table
4. Recreate the triggers, then run `INSERT INTO posts_fts(posts_fts) VALUES('rebuild')` to rebuild the full FTS index
5. For single-item operations (tag, unsave, individual inserts), the per-row triggers handle FTS sync

On startup, check that the FTS triggers exist and run `integrity-check`; only recreate triggers and rebuild the index if that consistency check fails.

### Search query pattern

```sql
-- FTS5 external content table requires JOIN on rowid
-- snippet col 0 = title (posts), col 2 = body (comments). Coalesce handles both.
SELECT p.*,
       coalesce(
         snippet(posts_fts, 0, '<b>', '</b>', '...', 32),
         snippet(posts_fts, 2, '<b>', '</b>', '...', 32),
         snippet(posts_fts, 1, '<b>', '</b>', '...', 32)
       ) AS snippet,
       bm25(posts_fts) AS rank
FROM posts_fts
JOIN posts p ON posts_fts.rowid = p.rowid
WHERE posts_fts MATCH ?
  AND p.subreddit = ?          -- optional filters
  AND p.score >= ?             -- optional filters
ORDER BY rank
LIMIT ? OFFSET ?;

-- Tag-filtered search uses EXISTS/subqueries rather than JOIN + GROUP BY,
-- because FTS5 auxiliary functions (bm25/snippet) need direct posts_fts context.
SELECT p.*,
       coalesce(
         snippet(posts_fts, 0, '<b>', '</b>', '...', 32),
         snippet(posts_fts, 2, '<b>', '</b>', '...', 32)
       ) AS snippet,
       (SELECT GROUP_CONCAT(t.name, '||')
          FROM post_tags pt
          JOIN tags t ON t.id = pt.tag_id
         WHERE pt.post_id = p.id) AS tags
FROM posts_fts
JOIN posts p ON posts_fts.rowid = p.rowid
WHERE posts_fts MATCH ?
  AND EXISTS (
    SELECT 1
    FROM post_tags pt2
    JOIN tags t2 ON t2.id = pt2.tag_id
    WHERE pt2.post_id = p.id
      AND t2.name = ?
  )
ORDER BY bm25(posts_fts);
```

### Auth storage

The app supports two on-disk credential files. Either can be active; if both
exist, `CompositeAuthProvider` prefers the session.

**Session mode (default)** — `session.json` (mode 0600) stores the cookie
payload posted by the companion extension:
```json
{
  "cookieHeader": "reddit_session=...; loid=...; ...",
  "userAgent": "Mozilla/5.0 ...",
  "modhash": "abc123...",
  "username": "auro",
  "capturedAt": 1712345678000
}
```
- **`cookieHeader`** is treated as a credential — never returned in API responses (`getSummary()` redacts it).
- **`modhash`** is Reddit's CSRF token, required for state-changing requests like `/api/unsave`. Refreshed by the extension on every sync and again by `SessionManager.verify()`.
- **`userAgent`** mirrors the real browser UA so the request looks like the same client that captured the cookies.
- **Atomic write**: `mkdirSync` (mode 0700) → `writeFileSync(tmp, ..., {mode: 0o600})` → `renameSync(tmp, sessionFile)`.

**OAuth mode (legacy)** — `auth.json` stores tokens for users with a registered Reddit app:
```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "tokenExpiry": 1712345678000,
  "username": "...",
  "clientId": "..."
}
```
- **App type**: Reddit "web app" — requires non-empty `clientSecret` for token exchange
- **Secret handling**: `clientSecret` is kept in memory and sourced from `REDDIT_CLIENT_SECRET` (or the initial login call); it is intentionally not persisted back to disk
- **Username**: fetched via `GET /api/v1/me` after initial token exchange and cached. Used for API endpoint URLs (`/user/{username}/saved`)
- **User-Agent**: `bun:reddit-saved:v0.1.0 (by /u/{username})` — Reddit requires descriptive user agents

### Token refresh concurrency

`TokenManager` uses a file-based lock (`auth.lock` in config dir) to prevent concurrent refresh:
1. Before refreshing, acquire lock (create `auth.lock` with PID, fail if exists and PID is alive)
2. Refresh token, write new auth.json
3. Release lock (delete `auth.lock`)
4. If lock is stale (PID dead), steal it

This prevents the race where CLI and web both try to refresh simultaneously, invalidating each other's refresh tokens.

### OAuth CSRF state

During the OAuth flow, the `:9638` callback server stores the CSRF state in closure memory (it lives for the duration of the server). Flow:
1. Generate state via `crypto.ts` (random 32-byte hex)
2. Store `{ state, expiresAt: Date.now() + 10min, returnTo?: string }` in a `Map` inside the server closure
3. On callback, validate state matches and hasn't expired
4. If `returnTo` is set (web-initiated), redirect browser there after writing auth.json

### Companion extension flow (cookie/session mode)

`packages/extension/` ships browser-specific MV3 manifests: the repo-root
`manifest.json` is Chrome-valid (`background.service_worker`), and the Firefox
build swaps in `manifest.firefox.json` (`background.scripts`) while reusing the
same `background.js` via `globalThis.browser ?? globalThis.chrome`.

1. On install, on browser start, every 30 min via `chrome.alarms`, and whenever
   reddit.com cookies change (immediately, with a 30-second alarm fallback if
   the MV3 worker is suspended), the extension:
   - Reads the reddit.com cookie jar via `chrome.cookies.getAll`.
   - Calls `GET https://www.reddit.com/api/me.json` with that cookie + the live
     `navigator.userAgent` to capture `username` and a fresh `modhash`.
   - POSTs `{cookies, cookieHeader, userAgent, modhash, username, capturedAt}`
     to `http://localhost:3001/api/auth/session` (falls back to `127.0.0.1`).
2. The Hono route validates the payload shape, verifies the request origin is
   either a `chrome-extension://` / `moz-extension://` URL or a same-host caller
   (the server already binds 127.0.0.1, so external attackers can't reach it),
   then calls `SessionManager.ingest(payload)` to atomically write
   `session.json`.
3. The next API call any route makes triggers `CompositeAuthProvider.ensureValid()`,
   which lazy-loads `session.json` if not already in memory, then resolves to a
   `Cookie`-mode `AuthContext` (baseUrl `https://www.reddit.com`, pathSuffix
   `.json`, headers include `Cookie` + `User-Agent` + optional `x-modhash`).
4. **Disconnect**: `DELETE /api/auth/session` clears the in-memory state and
   `unlinkSync`s `session.json`. The user must also remove the extension to
   stop new posts.

### Planned web auth return flow (Phase 4)

1. SPA on `:3001` redirects user to `/api/auth/login`
2. API server starts `:9638` OAuth callback server (if not running), passing `returnTo=http://localhost:3001`
3. Server builds Reddit authorize URL with `state` containing the return info
4. Reddit redirects to `localhost:9638?code=...&state=...`
5. Handler validates state, calls `TokenManager.exchangeCode()`, writes `auth.json`
6. Handler redirects browser to `http://localhost:3001` (from `returnTo`)
7. SPA polls `GET /api/auth/status` → detects authenticated, loads dashboard
8. OAuth server shuts down via `server.stop(true)` — with a 5-minute timeout if user never completes
9. Before starting, check if `:9638` is already bound (stale prior login attempt) — if so, shut it down first or reuse it

### First-run experience

If a command that requires Reddit auth is run before `auth login` (`fetch`, or non-dry-run `unsave`), it exits with code 2 and prints to stderr:
```json
{"error": "Not authenticated. Run 'reddit-saved auth login' first.", "code": "AUTH_REQUIRED"}
```
In `--human` mode: `Error: Not authenticated. Run 'reddit-saved auth login' first.`

## CLI Commands

```
reddit-saved auth login|status|logout
reddit-saved fetch [--full] [--type saved|upvoted|submitted|comments] [--limit N]
reddit-saved search <query> [--subreddit X] [--author A] [--min-score N] [--after DATE]
                            [--before DATE] [--tag TAG] [--orphaned] [--type post|comment]
                            [--limit N] [--offset N]
reddit-saved list [--subreddit X] [--author A] [--min-score N] [--tag TAG] [--orphaned]
                  [--type post|comment] [--origin saved|upvoted|submitted|commented]
                  [--sort created|score] [--sort-direction asc|desc] [--limit N] [--offset N]
                  # browse without FTS query — just filters + sort
reddit-saved export [--format json|csv|markdown] [--output PATH] [--subreddit X] [--tag TAG]
                    [--orphaned] [--type post|comment] [--limit N] [--include-raw]
reddit-saved status                    # includes orphaned count, tag counts
reddit-saved unsave [--id ID...] [--subreddit X] [--tag TAG] [--orphaned]
                    [--limit N] [--dry-run] --confirm
                    # Flow: query local DB with filters → show matching items →
                    # if --confirm: call Reddit POST /api/unsave for each item's
                    # fullname, then mark is_on_reddit=0 locally.
                    # --dry-run shows what would be unsaved without calling API.

# Tag management (local-only, not synced to Reddit)
reddit-saved tag list                  # all tags with post counts
reddit-saved tag create <name> [--color #hex]
reddit-saved tag rename <old> <new>
reddit-saved tag delete <name>
reddit-saved tag add <tag> --to <post_id> [<post_id>...]   # no-op if already tagged
reddit-saved tag remove <tag> --from <post_id> [<post_id>...]
reddit-saved tag show <post_id>        # list tags on a post
# <post_id> is the Reddit ID without prefix (the `id` column, e.g., abc123).
# Same format for unsave --id. Shown in search/list output.

Global: --human/-H (tables), --verbose/-v, --quiet/-q, --db PATH, --config PATH
Exit codes: 0=success, 1=error, 2=auth required
```

## Implementation Phases

### Phase 1: Core Foundation
1. Scaffold monorepo (root package.json, bunfig.toml, tsconfig, biome.json)
2. Write utils/paths.ts (platform-aware config/data directories)
3. Port types.ts, constants.ts (strip Obsidian-specific items, define `RequestParams`/`RequestResponse` types to replace Obsidian's, add `USER_AGENT_TEMPLATE`, `ApiClientCallbacks`)
4. Port queue classes (CircuitBreaker, RateLimiter) — extract from single file to individual modules
5. Write OfflineQueue + RequestQueue with native fetch() + AbortSignal and new request types
6. Write auth/token-manager.ts + auth/crypto.ts + auth/oauth-state.ts + auth/oauth-server.ts
7. Write storage types/interface in `types.ts` + schema.ts + mapper.ts + sqlite-adapter.ts + FTS5 (including tags tables, bulk rebuild strategy, startup FTS5 assertion, crash-recovery rebuild)
8. Write tags/tag-manager.ts (CRUD, post-tag associations, takes Database handle directly)
9. Tests for all above

### Phase 2: API Client + Filters + Sync
1. Write api/client.ts (RedditApiClient with fetch)
2. Port filters/engine.ts + presets.ts
3. Write sync/state-manager.ts (Bun.file persistence)
4. Write sync/diff.ts (orphan detection via is_on_reddit + last_seen_at)
5. Port monitor/performance.ts
6. Tests

### Phase 3: CLI (Complete)
1. Entry point, arg parser (hand-rolled, handles nested subcommands), output formatters
2. `auth login/status/logout` (login uses core oauth-server)
3. `fetch` + `search` + `list` + `status` (search/list support --tag, --orphaned, --author)
4. `tag list/create/rename/delete/add/remove/show`
5. `export` + `unsave` (unsave requires --confirm)
6. Tests

### Phase 4: Web (implemented)
1. Scaffolded Vite + React 19 + Tailwind v4, TanStack Router/Query/Virtual, Radix primitives
2. Hono API server on :3001 with `auth`, `posts`, `posts/search`, `tags`, `sync/fetch` (SSE), `sync/status`, `sync/cancel`, `unsave`, `export`, `health` routes. In production, serves the Vite build output and falls back to `index.html` for non-`/api/*` and non-asset paths (SPA client-side routing). CSP allowlists Reddit CDN hosts (`i.redd.it`, `v.redd.it`, `preview.redd.it`, `external-preview.redd.it`, `*.thumbs.redditmedia.com`)
3. `TEST_MODE=1` env disables Reddit writes, stubs OAuth, and short-circuits `unsave` — refuses to run under `NODE_ENV=production`
4. SSE via Hono's `streamSSE` for sync progress; client uses `EventSource` (GET). `RedditApiClient` exposes `setCallbacks`/`getCallbacks` so the SSE route can swap in stream-routing callbacks without touching private state
5. SPA pages: `RootLayout` (topbar, dark toggle, sync indicator), `HomePage`, `BrowsePage` (URL-synced filters via router `validateSearch`), `PostPage` (MediaEmbed, TagEditor, confirm-gated unsave), `SettingsPage` (auth, sync, export, TagManager), `LoginPage` (polled auth status during OAuth)
6. Components: PostCard, virtualized PostList (TanStack Virtual), SearchBar (debounced), FilterPanel, TagChips, TagEditor, TagManager, SyncStatus, MediaEmbed, EmptyState, ErrorState, ConfirmDialog, DarkModeToggle, ErrorBoundary
7. Query hooks: `usePosts`, `useSearchPosts`, `usePost`, `useTags`, `useAuthStatus`, `useSyncStatus`, `useSyncStream` (SSE), `useUnsave`, tag CRUD mutations, `downloadExport`
8. Seed script (`scripts/seed.ts`): deterministic 200-item fixture (mulberry32 PRNG) exercising image/gallery/video/external/self/comment variants, ~10% orphaned, 6 tag fixtures
9. Tests: bun test + happy-dom + @testing-library/react for component tests (PostCard, FilterPanel, SearchBar, EmptyState, utils); Playwright smoke suite under `TEST_MODE=1`

## Verification
- `bun test packages/core/tests` — passes
- `bun test packages/cli/tests` — passes
- `bun run packages/cli/src/index.ts --help` — prints current CLI surface
- `bun run --filter @reddit-saved/web typecheck` — passes
- `bun run --filter @reddit-saved/web build` — produces a Vite bundle in `packages/web/dist`
- `bun run --filter @reddit-saved/web test` — bun test + happy-dom component tests pass
- `bun run --filter @reddit-saved/web seed` — populates `./dev-data/reddit-saved.db` with 200 fixture items
- `TEST_MODE=1 bun run --filter @reddit-saved/web dev` — runs API (:3001) + Vite (:3000) with Reddit writes/OAuth stubbed

## Known Limitations & Future Work
- **Reddit 1000-item API cap**: Reddit's listing endpoints return max 1000 items. Users with >1000 saves will only get the newest 1000 via the API. Orphan detection is disabled when local count >= 1000 to avoid false positives. Future: investigate GDPR data export (used by Reddit-Saved-Post-Extractor) as a bypass for initial import.
- **Single redirect URI**: One Reddit app, one callback at localhost:9638. Both CLI and web share it. If both start an OAuth flow simultaneously, one flow will fail with a clear "port already in use" error. Token refresh is safe via file-lock.
- **Single-origin storage model**: `posts.content_origin` records only the first endpoint that introduced an item. This keeps the schema simple for Phase 3, but multi-origin items are not counted independently per origin and origin-scoped orphan detection is conservative for later-seen origins. Future: add a `content_origins` membership table if we need exact per-origin accounting.
- **No backup**: SQLite DB backup is not implemented. Users can manually copy the DB file. May add `reddit-saved backup` in the future.
- **CLI arg parsing complexity**: Zero npm deps means hand-rolled arg parser. Nested subcommands (`tag create`, `tag add`) are non-trivial — acknowledge implementation effort in Phase 3.
- **FTS crash recovery**: If the process crashes between dropping triggers and rebuilding the FTS index, the index may be stale. Mitigated by startup trigger/integrity checks that rebuild only when needed.
- **Web uses EventSource for sync progress**: `EventSource` is GET-only and cannot attach auth headers. The `/api/sync/fetch` SSE endpoint is GET-mounted to keep it usable. An auth token query parameter or switch to `fetch` + a manual SSE parser would be needed for cross-origin deployment; the current app is single-origin (Vite proxy in dev, same origin in prod)
- **`TEST_MODE` is a dev/test affordance**: Asserts it is not running under `NODE_ENV=production`, but it disables Reddit writes entirely. Do not accidentally ship a `TEST_MODE=1` build

## Reference Files
- `/home/auro/code/reddit_saved/reference/saved-reddit-exporter/src/request-queue.ts` — CircuitBreaker (L84-185), RateLimiter (L190-264), OfflineQueue (L269-326), RequestQueue (L331-679)
- `/home/auro/code/reddit_saved/reference/saved-reddit-exporter/src/types.ts` — All Reddit types
- `/home/auro/code/reddit_saved/reference/saved-reddit-exporter/src/api-client.ts` — RedditApiClient pagination/rate limit patterns
- `/home/auro/code/reddit_saved/reference/saved-reddit-exporter/src/auth.ts` — Token exchange (L480-510), refresh (L512-542), validation (L544-548)
- `/home/auro/code/reddit_saved/reference/saved-reddit-exporter/src/filters.ts` — FilterEngine, zero Obsidian deps
- `/home/auro/code/reddit_saved/reference/saved-reddit-exporter/src/constants.ts` — OAuth URLs, rate limit values
