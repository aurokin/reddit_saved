import type { Database } from "bun:sqlite";
import { FTS_TRIGGER_STATEMENTS, LATEST_SCHEMA_VERSION, runMigrations } from "./migrations";

// ============================================================================
// Initialization
// ============================================================================

/** Set connection pragmas — call on every db open */
export function setPragmas(db: Database): void {
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA busy_timeout = 5000");
  db.run("PRAGMA foreign_keys = ON");
}

/** Bring the database to the latest schema version, creating it if needed. */
export function initializeSchema(db: Database): void {
  // Pragmas must run outside transactions (silently ignored inside one in WAL mode)
  setPragmas(db);

  // Newer-than-code check BEFORE running migrations. This must stay outside
  // any transaction: if it threw inside one, the rollback would undo the
  // schema_version bookkeeping and the next startup would silently succeed.
  const hasVersionTable = db
    .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'")
    .get();
  if (hasVersionTable) {
    const existing = db
      .query("SELECT version FROM schema_version ORDER BY version DESC LIMIT 1")
      .get() as { version: number } | null;
    if (existing && existing.version > LATEST_SCHEMA_VERSION) {
      throw new Error(
        `Database schema (v${existing.version}) is newer than this code (v${LATEST_SCHEMA_VERSION}). Update the application or use a compatible database.`,
      );
    }
  }

  runMigrations(db);
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
    try {
      db.run("ROLLBACK TO SAVEPOINT fts5_probe");
      db.run("RELEASE SAVEPOINT fts5_probe");
    } catch {
      /* cleanup */
    }
    throw new Error(
      "SQLite FTS5 extension is not available. Bun's built-in SQLite should include it.",
    );
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
