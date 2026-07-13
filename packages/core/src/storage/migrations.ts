import type { Database } from "bun:sqlite";

// ============================================================================
// Ordered schema migrations
//
// Versioning is keyed off the existing `schema_version` table (one row per
// applied migration), so v1 databases created before this framework existed
// are already at the right starting point with no bootstrap step.
//
// Rules for authoring a migration:
// - Versions are consecutive integers; runMigrations throws on gaps.
// - Each migration runs inside a transaction together with its version-row
//   insert, so a failed `up()` leaves the version untouched.
// - Never add columns to the posts_fts column list — the FTS external-content
//   table, its three triggers, and snippet() column indices are coupled.
//   A migration that must rebuild posts rows should call dropFtsTriggers /
//   createFtsTriggers / rebuildFtsIndex from schema.ts itself inside up().
// - Timestamp units: created_utc is epoch SECONDS; every *_at column is
//   epoch MILLISECONDS. Document the unit on any new column.
// ============================================================================

export interface Migration {
  version: number;
  name: string;
  up(db: Database): void;
}

// Baseline DDL (migration v1) — everything IF NOT EXISTS so re-running on a
// pre-framework v1 database is a no-op.
const BASELINE_DDL_STATEMENTS = [
  // Core posts table
  `CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    content_origin TEXT NOT NULL DEFAULT 'saved',
    title TEXT, author TEXT NOT NULL, subreddit TEXT NOT NULL,
    permalink TEXT NOT NULL, url TEXT, domain TEXT,
    selftext TEXT, body TEXT,
    score INTEGER NOT NULL DEFAULT 0, created_utc INTEGER NOT NULL,
    num_comments INTEGER, upvote_ratio REAL,
    is_self INTEGER, over_18 INTEGER DEFAULT 0,
    is_video INTEGER DEFAULT 0, is_gallery INTEGER DEFAULT 0,
    post_hint TEXT, link_flair_text TEXT,
    thumbnail TEXT,
    preview_url TEXT,

    -- Comment-specific fields
    parent_id TEXT,
    link_id TEXT,
    link_title TEXT,
    link_permalink TEXT,
    is_submitter INTEGER DEFAULT 0,

    -- Status flags
    distinguished TEXT,
    edited INTEGER DEFAULT NULL,
    stickied INTEGER DEFAULT 0,
    spoiler INTEGER DEFAULT 0,
    locked INTEGER DEFAULT 0,
    archived INTEGER DEFAULT 0,
    fetched_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    is_on_reddit INTEGER NOT NULL DEFAULT 1,
    last_seen_at INTEGER NOT NULL,
    raw_json TEXT NOT NULL
  )`,

  // Full-text search index (external content table)
  `CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
    title, selftext, body, subreddit, author, link_flair_text, url, domain,
    content='posts', content_rowid='rowid',
    tokenize='porter unicode61'
  )`,

  // Indexes
  "CREATE INDEX IF NOT EXISTS idx_posts_subreddit ON posts(subreddit)",
  "CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author)",
  "CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_utc)",
  "CREATE INDEX IF NOT EXISTS idx_posts_score ON posts(score)",
  "CREATE INDEX IF NOT EXISTS idx_posts_kind ON posts(kind)",
  "CREATE INDEX IF NOT EXISTS idx_posts_origin ON posts(content_origin)",
  "CREATE INDEX IF NOT EXISTS idx_posts_on_reddit ON posts(is_on_reddit)",

  // Tags
  `CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK(length(trim(name)) > 0),
    color TEXT,
    created_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS post_tags (
    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (post_id, tag_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_post_tags_tag ON post_tags(tag_id)",

  // Sync state tracking
  `CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  // Schema versioning
  `CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`,
];

// FTS triggers — also part of the v1 baseline; exported for the bulk-insert
// drop/recreate cycle in schema.ts.
export const FTS_TRIGGER_STATEMENTS = [
  `CREATE TRIGGER IF NOT EXISTS posts_ai AFTER INSERT ON posts BEGIN
    INSERT INTO posts_fts(rowid, title, selftext, body, subreddit, author, link_flair_text, url, domain)
    VALUES (new.rowid, new.title, new.selftext, new.body, new.subreddit, new.author, new.link_flair_text, new.url, new.domain);
  END`,

  `CREATE TRIGGER IF NOT EXISTS posts_ad AFTER DELETE ON posts BEGIN
    INSERT INTO posts_fts(posts_fts, rowid, title, selftext, body, subreddit, author, link_flair_text, url, domain)
    VALUES ('delete', old.rowid, old.title, old.selftext, old.body, old.subreddit, old.author, old.link_flair_text, old.url, old.domain);
  END`,

  `CREATE TRIGGER IF NOT EXISTS posts_au AFTER UPDATE ON posts BEGIN
    INSERT INTO posts_fts(posts_fts, rowid, title, selftext, body, subreddit, author, link_flair_text, url, domain)
    VALUES ('delete', old.rowid, old.title, old.selftext, old.body, old.subreddit, old.author, old.link_flair_text, old.url, old.domain);
    INSERT INTO posts_fts(rowid, title, selftext, body, subreddit, author, link_flair_text, url, domain)
    VALUES (new.rowid, new.title, new.selftext, new.body, new.subreddit, new.author, new.link_flair_text, new.url, new.domain);
  END`,
];

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "baseline schema",
    up(db) {
      for (const stmt of BASELINE_DDL_STATEMENTS) {
        db.run(stmt);
      }
      for (const stmt of FTS_TRIGGER_STATEMENTS) {
        db.run(stmt);
      }
    },
  },
  {
    version: 2,
    name: "sync run provenance",
    up(db) {
      // started_at/finished_at are epoch MILLISECONDS. finished_at NULL means
      // the run crashed or is in flight. saturated=1 records that orphan
      // detection was skipped because the origin sits at Reddit's ~1000-item
      // listing cap — completeness cannot be verified past that window.
      db.run(`CREATE TABLE IF NOT EXISTS sync_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        origin TEXT NOT NULL,
        mode TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        fetched INTEGER NOT NULL DEFAULT 0,
        orphaned INTEGER,
        saturated INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL
      )`);
      db.run("CREATE INDEX IF NOT EXISTS idx_sync_runs_origin ON sync_runs(origin, finished_at)");
    },
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/** Highest applied migration version, or 0 for a brand-new database. */
export function getSchemaVersion(db: Database): number {
  const hasVersionTable = db
    .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'")
    .get();
  if (!hasVersionTable) return 0;
  const row = db.query("SELECT MAX(version) AS version FROM schema_version").get() as {
    version: number | null;
  } | null;
  return row?.version ?? 0;
}

/** Apply all pending migrations in order. Returns the resulting version. */
export function runMigrations(db: Database, migrations: readonly Migration[] = MIGRATIONS): number {
  let current = getSchemaVersion(db);
  const pending = [...migrations]
    .filter((m) => m.version > current)
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    if (migration.version !== current + 1) {
      throw new Error(
        `Missing database migration between v${current} and v${migration.version} ("${migration.name}").`,
      );
    }
    db.transaction(() => {
      migration.up(db);
      db.run("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)", [
        migration.version,
        Date.now(),
      ]);
    })();
    current = migration.version;
  }
  return current;
}
