# Reddit Saved — Bun/TypeScript Monorepo

## Context

We analyzed 9 GitHub projects for managing Reddit saved posts. **saved-reddit-exporter** (Obsidian plugin, 99 commits) has the most production-grade Reddit API layer: circuit breaker, token bucket rate limiting, exponential backoff, resumable pagination, and offline queue. We're using it as a reference to build a new standalone tool with two interfaces: a CLI for agent/programmatic use and a React web app for humans.

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
│   │   │   │   ├── interface.ts       # StorageAdapter interface
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
│   │   │   ├── cli.ts                 # Global options (--json, --human, -v)
│   │   │   ├── output.ts              # JSON/table/progress formatters
│   │   │   ├── config.ts              # ~/.config/reddit-saved/ management
│   │   │   ├── auth/                  # login (uses core oauth-server), status, logout
│   │   │   └── commands/              # fetch, search, list, export, status, unsave, tag
│   │   └── tests/
│   │
│   └── web/                           # @reddit-saved/web
│       ├── vite.config.ts
│       ├── src/
│       │   ├── main.tsx
│       │   ├── api/
│       │   │   ├── server.ts          # Bun.serve() API on :3001 (data + proxy)
│       │   │   └── routes/            # auth (uses core oauth-server), posts, sync, export, tags
│       │   ├── components/            # PostCard, PostList, SearchBar, FilterPanel, etc.
│       │   ├── pages/                 # Home, Browse, Post, Settings, Login
│       │   └── hooks/                 # useSearch, usePosts, useSync, useAuth
│       └── tests/
```

## Key Design Decisions

| Decision | Choice | Why |
|---|---|---|
| Storage | SQLite via `bun:sqlite` | Zero deps, FTS5 for search, single-file portable |
| Search | FTS5 with `porter unicode61` tokenizer, BM25 ranking | Covers title/selftext/body/subreddit/author. Tag-filtered search via JOIN. Sufficient for <=1000 items |
| Auth | Single Reddit **"web app"** (requires client_secret), shared `localhost:9638` redirect URI for both CLI and Web. `TokenManager` in core handles exchange/refresh. File-lock (`auth.lock`) prevents concurrent token refresh races. | Reddit allows only ONE redirect URI per app. "Web app" type chosen because localhost redirect requires client_secret. Both surfaces share the callback — web initiates OAuth via :9638, handler writes auth.json then redirects browser to `http://localhost:3001`, SPA polls `/api/auth/status` |
| CLI output | JSON to stdout (default), `--human` flag for tables | Agent-first, composable with jq/pipes. Errors to stderr |
| Web | React 19 SPA (Vite) + Bun.serve() API on :3001 | Clean separation; API server reuses same core + SQLite as CLI |
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
- Entire web app (API server, React SPA, components)

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
    edited INTEGER DEFAULT 0,      -- 0 or unix timestamp of last edit
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
-- Keys: last_cursor, last_sync_time, last_full_sync_time, session_id, total_fetched

CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
```

### Sync & removal detection

- **Incremental sync** (`reddit-saved fetch`): Uses cursor-based pagination (`after` param). New items are inserted, existing items are updated (score, num_comments, etc.). `last_seen_at` is updated for every item seen.
- **Full sync** (`reddit-saved fetch --full`): Fetches all saved items from Reddit. Orphan detection runs **only if local item count < 1000**. If >=1000 items exist locally, orphan detection is skipped and a warning is printed: "Reddit's API limits results to 1000 items. Orphan detection skipped — older items beyond this window cannot be verified." When orphan detection runs: any local item whose `last_seen_at` is older than the sync start time is marked `is_on_reddit = 0`. These items remain searchable — never deleted automatically.
- **User can choose**: `reddit-saved status` shows orphaned count. `reddit-saved search --orphaned` finds them. They keep their tags and remain in FTS.

### StorageAdapter interface

`storage/interface.ts` defines the contract. `SqliteAdapter` implements it. `TagManager` takes the same `Database` handle but has its own API — it's not behind `StorageAdapter`.

```typescript
interface StorageAdapter {
  // Posts
  upsertPosts(items: RedditItem[], origin: ContentOrigin): void;  // bulk upsert in transaction
  getPost(id: string): PostRow | null;
  listPosts(opts: ListOptions): PostRow[];         // filter, sort, paginate
  searchPosts(query: string, opts: SearchOptions): SearchResult[];  // FTS5
  markOrphaned(olderThan: number): number;          // returns count affected
  getStats(): DbStats;                              // totals, subreddit counts, etc.

  // Sync state (key-value for completed-sync metadata)
  getSyncState(key: string): string | null;
  setSyncState(key: string, value: string): void;

  // Unsave
  markUnsaved(ids: string[]): void;                 // set is_on_reddit=0 for specific posts

  // Maintenance
  rebuildFtsIndex(): void;
  assertFts5Available(): void;                      // startup check
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
CLI implements these to write progress to stderr. Web implements them to push SSE events.

### Sync state vs sync_state table

These serve different purposes:
- **`sync_state` SQL table**: Stores completed-sync metadata (key-value pairs like `last_cursor`, `last_sync_time`, `last_full_sync_time`). Persistent across sessions. Managed via `StorageAdapter.getSyncState/setSyncState`.
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

  // Single item
  fetchPostComments(permalink: string, threshold?: number): Promise<RedditComment[]>;

  // Actions
  unsaveItem(fullname: string): Promise<void>;        // POST /api/unsave
  unsaveItems(fullnames: string[]): Promise<void>;     // batch with rate limiting

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

A post can appear in multiple endpoints (e.g., saved AND upvoted). The `content_origin` column tracks how the item was *first* fetched. If the same item appears via a different `--type` fetch, we update metadata (score, etc.) but **do not overwrite** `content_origin` — the upsert SQL omits `content_origin` from the `ON CONFLICT ... DO UPDATE SET` clause, preserving the original value. The `raw_json` is always updated to the latest version. Future: could add a `content_origins` junction table if multi-origin tracking becomes important.

### FTS bulk insert strategy

During `fetch`, all inserts happen inside a single SQLite transaction. For bulk operations:
1. `DROP TRIGGER` the three FTS sync triggers (posts_ai, posts_ad, posts_au)
2. Wrap all inserts in `db.transaction(() => { ... })` (bun:sqlite's preferred API)
3. Insert/upsert into `posts` table
4. After commit, recreate the triggers, then run `INSERT INTO posts_fts(posts_fts) VALUES('rebuild')` to rebuild the full FTS index
5. For single-item operations (tag, unsave, individual inserts), the per-row triggers handle FTS sync

On startup, always run `rebuild` if the DB exists — this handles crash recovery where triggers may have been dropped but not recreated.

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

-- Tag-filtered search
SELECT p.*,
       coalesce(
         snippet(posts_fts, 0, '<b>', '</b>', '...', 32),
         snippet(posts_fts, 2, '<b>', '</b>', '...', 32)
       ) AS snippet
FROM posts_fts
JOIN posts p ON posts_fts.rowid = p.rowid
JOIN post_tags pt ON pt.post_id = p.id
JOIN tags t ON t.id = pt.tag_id
WHERE posts_fts MATCH ?
  AND t.name = ?
ORDER BY bm25(posts_fts);
```

### Auth storage

`auth.json` (in platform-appropriate config dir) stores:
```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "tokenExpiry": 1712345678000,
  "username": "...",
  "clientId": "...",
  "clientSecret": "..."
}
```
- **App type**: Reddit "web app" — requires non-empty `clientSecret` for token exchange
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

### Web auth return flow

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

If any command is run before `auth login`, it exits with code 2 and prints to stderr:
```json
{"error": "Not authenticated. Run 'reddit-saved auth login' first.", "code": "AUTH_REQUIRED"}
```
In `--human` mode: `Error: Not authenticated. Run 'reddit-saved auth login' to connect your Reddit account.`

## CLI Commands

```
reddit-saved auth login|status|logout
reddit-saved fetch [--full] [--type saved|upvoted|submitted|comments]
reddit-saved search <query> [--subreddit X] [--author A] [--min-score N] [--after DATE]
                            [--before DATE] [--tag TAG] [--orphaned] [--type post|comment]
                            [--limit N] [--offset N]
reddit-saved list [--subreddit X] [--author A] [--min-score N] [--tag TAG] [--orphaned]
                  [--type post|comment] [--sort created|score] [--limit N] [--offset N]
                  # browse without FTS query — just filters + sort
reddit-saved export [--format json|csv|markdown] [--output PATH]
reddit-saved status                    # includes orphaned count, tag counts
reddit-saved unsave [--id ID...] [--subreddit X] [--tag TAG] [--orphaned]
                    [--dry-run] --confirm
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
7. Write storage/interface.ts + schema.ts + mapper.ts + sqlite-adapter.ts + FTS5 (including tags tables, bulk rebuild strategy, startup FTS5 assertion via `pragma_compile_options`, crash-recovery rebuild)
8. Write tags/tag-manager.ts (CRUD, post-tag associations, takes Database handle directly)
9. Tests for all above

### Phase 2: API Client + Filters + Sync
1. Write api/client.ts (RedditApiClient with fetch)
2. Port filters/engine.ts + presets.ts
3. Write sync/state-manager.ts (Bun.file persistence)
4. Write sync/diff.ts (orphan detection via is_on_reddit + last_seen_at)
5. Port monitor/performance.ts
6. Tests

### Phase 3: CLI (Under Review)
1. Entry point, arg parser (hand-rolled, handles nested subcommands), output formatters
2. `auth login/status/logout` (login uses core oauth-server)
3. `fetch` + `search` + `list` + `status` (search/list support --tag, --orphaned, --author)
4. `tag list/create/rename/delete/add/remove/show`
5. `export` + `unsave` (unsave requires --confirm)
6. Tests

### Phase 4: Web
1. Scaffold Vite + React 19 + Tailwind v4
2. Bun.serve() API server + auth/posts/sync/export/tag routes. In production, serve Vite-built `index.html` as fallback for any non-`/api/*` and non-static-asset request (SPA client-side routing support)
3. SPA pages (Home, Browse, Post, Settings)
4. Components (PostCard, SearchBar, FilterPanel, TagChips, TagManager, SyncStatus)
5. Tests

## Verification
- `bun test` — all packages
- `bun run packages/cli/src/index.ts auth login` — completes OAuth flow
- `bun run packages/cli/src/index.ts fetch --human` — fetches posts with progress
- `bun run packages/cli/src/index.ts search "test query"` — returns JSON results
- `bun run packages/cli/src/index.ts search "rust" --tag ml` — tag-filtered search
- `bun run packages/cli/src/index.ts tag create "machine-learning" --color "#4ade80"` — creates tag
- `bun run packages/cli/src/index.ts tag add "machine-learning" --to abc123` — tags a post
- `bun run packages/cli/src/index.ts fetch --full` — detects orphaned saves
- `bun run packages/cli/src/index.ts list --subreddit rust --limit 10` — browse without FTS query
- `bun run packages/cli/src/index.ts export --format json --output ./export.json` — exports to file
- `bun run packages/cli/src/index.ts unsave --id abc123 --dry-run --confirm` — dry-run unsave
- `bun run packages/cli/src/index.ts status` — shows total, orphaned, tag counts
- `bun run dev:web` — SPA loads, can browse/search/tag saved posts

## Known Limitations & Future Work
- **Reddit 1000-item API cap**: Reddit's listing endpoints return max 1000 items. Users with >1000 saves will only get the newest 1000 via the API. Orphan detection is disabled when local count >= 1000 to avoid false positives. Future: investigate GDPR data export (used by Reddit-Saved-Post-Extractor) as a bypass for initial import.
- **Single redirect URI**: One Reddit app, one callback at localhost:9638. Both CLI and web share it. If both start an OAuth flow simultaneously, port conflict occurs — document this. Token refresh is safe via file-lock.
- **No backup**: SQLite DB backup is not implemented. Users can manually copy the DB file. May add `reddit-saved backup` in the future.
- **CLI arg parsing complexity**: Zero npm deps means hand-rolled arg parser. Nested subcommands (`tag create`, `tag add`) are non-trivial — acknowledge implementation effort in Phase 3.
- **FTS crash recovery**: If the process crashes between dropping triggers and rebuilding the FTS index, the index will be stale. Mitigated by running `rebuild` on every startup.

## Reference Files
- `/home/auro/code/reddit_saved/saved-reddit-exporter/src/request-queue.ts` — CircuitBreaker (L84-185), RateLimiter (L190-264), OfflineQueue (L269-326), RequestQueue (L331-679)
- `/home/auro/code/reddit_saved/saved-reddit-exporter/src/types.ts` — All Reddit types
- `/home/auro/code/reddit_saved/saved-reddit-exporter/src/api-client.ts` — RedditApiClient pagination/rate limit patterns
- `/home/auro/code/reddit_saved/saved-reddit-exporter/src/auth.ts` — Token exchange (L480-510), refresh (L512-542), validation (L544-548)
- `/home/auro/code/reddit_saved/saved-reddit-exporter/src/filters.ts` — FilterEngine, zero Obsidian deps
- `/home/auro/code/reddit_saved/saved-reddit-exporter/src/constants.ts` — OAuth URLs, rate limit values
