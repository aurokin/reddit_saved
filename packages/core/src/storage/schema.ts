import type { Database } from "bun:sqlite";

// ============================================================================
// Schema DDL — individual statements for reliable execution with db.run()
// ============================================================================

const SCHEMA_VERSION = 1;

const DDL_STATEMENTS = [
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

// FTS triggers — individual statements for reliable execution
const FTS_TRIGGER_STATEMENTS = [
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

// ============================================================================
// Initialization
// ============================================================================

/** Set connection pragmas — call on every db open */
export function setPragmas(db: Database): void {
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA busy_timeout = 5000");
  db.run("PRAGMA foreign_keys = ON");
}

/** Create all tables and indexes if they don't exist */
export function initializeSchema(db: Database): void {
  // Pragmas must run outside transactions (silently ignored inside one in WAL mode)
  setPragmas(db);

  // Check schema version BEFORE the DDL transaction. If we threw inside the
  // transaction, the rollback would undo the schema_version table creation,
  // and the next startup would silently succeed — defeating the guard.
  const hasVersionTable = db.query(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'",
  ).get();
  if (hasVersionTable) {
    const existing = db.query(
      "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
    ).get() as { version: number } | null;
    if (existing && existing.version > SCHEMA_VERSION) {
      throw new Error(
        `Database schema (v${existing.version}) is newer than this code (v${SCHEMA_VERSION}). Update the application or use a compatible database.`,
      );
    }
    if (existing && existing.version < SCHEMA_VERSION) {
      throw new Error(
        `Database schema (v${existing.version}) is older than code (v${SCHEMA_VERSION}). Run the migration tool first.`,
      );
    }
  }

  db.transaction(() => {
    for (const stmt of DDL_STATEMENTS) {
      db.run(stmt);
    }
    for (const stmt of FTS_TRIGGER_STATEMENTS) {
      db.run(stmt);
    }

    // Record schema version on first init
    const existing = db.query("SELECT version FROM schema_version ORDER BY version DESC LIMIT 1").get() as { version: number } | null;
    if (!existing) {
      db.run("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)", [SCHEMA_VERSION, Date.now()]);
    }
  })();
}

/** Assert FTS5 is available at startup by attempting to create a probe table.
 * PRAGMA compile_options doesn't list ENABLE_FTS5 when it's compiled in by default. */
export function assertFts5Available(db: Database): void {
  try {
    db.run("SAVEPOINT fts5_probe");
    db.run("CREATE VIRTUAL TABLE _fts5_probe USING fts5(x)");
    db.run("ROLLBACK TO SAVEPOINT fts5_probe");
    db.run("RELEASE SAVEPOINT fts5_probe");
  } catch {
    try { db.run("ROLLBACK TO SAVEPOINT fts5_probe"); db.run("RELEASE SAVEPOINT fts5_probe"); } catch { /* cleanup */ }
    throw new Error("SQLite FTS5 extension is not available. Bun's built-in SQLite should include it.");
  }
}

/** Rebuild FTS index — call on startup for crash recovery and after bulk inserts */
export function rebuildFtsIndex(db: Database): void {
  db.run("INSERT INTO posts_fts(posts_fts) VALUES('rebuild')");
}

/** Drop FTS triggers (for bulk insert performance) */
export function dropFtsTriggers(db: Database): void {
  db.run("DROP TRIGGER IF EXISTS posts_ai");
  db.run("DROP TRIGGER IF EXISTS posts_ad");
  db.run("DROP TRIGGER IF EXISTS posts_au");
}

/** Recreate FTS triggers (after bulk insert) */
export function createFtsTriggers(db: Database): void {
  for (const stmt of FTS_TRIGGER_STATEMENTS) {
    db.run(stmt);
  }
}
