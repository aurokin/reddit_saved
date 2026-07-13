import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  type Migration,
  getSchemaVersion,
  runMigrations,
} from "../src/storage/migrations";
import { initializeSchema } from "../src/storage/schema";
import { SqliteAdapter } from "../src/storage/sqlite-adapter";
import type { RedditItem } from "../src/types";

function makeItem(id: string, title: string): RedditItem {
  return {
    kind: "t3",
    data: {
      id,
      name: `t3_${id}`,
      title,
      author: "testuser",
      subreddit: "test",
      permalink: `/r/test/comments/${id}/post/`,
      created_utc: 1700000000,
      score: 1,
    },
  };
}

describe("migrations", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "reddit-cached-migrations-"));
    dbPath = join(dir, "test.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("fresh database migrates to the latest version with all tables", () => {
    const db = new Database(dbPath);
    initializeSchema(db);

    expect(getSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    for (const expected of ["posts", "tags", "post_tags", "sync_state", "schema_version"]) {
      expect(names).toContain(expected);
    }
    const triggers = db.query("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as {
      name: string;
    }[];
    expect(triggers.map((t) => t.name).sort()).toEqual(["posts_ad", "posts_ai", "posts_au"]);
    db.close();
  });

  test("re-opening an already-migrated database is a no-op", () => {
    const db1 = new Database(dbPath);
    initializeSchema(db1);
    db1.close();

    const db2 = new Database(dbPath);
    initializeSchema(db2);
    expect(getSchemaVersion(db2)).toBe(LATEST_SCHEMA_VERSION);
    const versionRows = db2.query("SELECT COUNT(*) AS n FROM schema_version").get() as {
      n: number;
    };
    expect(versionRows.n).toBe(LATEST_SCHEMA_VERSION);
    db2.close();
  });

  test("migrating a seeded database preserves rows, tags, and FTS", () => {
    const adapter = new SqliteAdapter(dbPath);
    adapter.upsertPosts([makeItem("aaa", "Rust lifetimes explained")], "saved");
    adapter.close();

    // Re-open through the full init path (runs any pending migrations).
    const adapter2 = new SqliteAdapter(dbPath);
    expect(getSchemaVersion(adapter2.getDb())).toBe(LATEST_SCHEMA_VERSION);
    expect(adapter2.getPost("aaa")?.title).toBe("Rust lifetimes explained");
    expect(adapter2.searchPosts("lifetimes", {}).map((r) => r.id)).toEqual(["aaa"]);
    adapter2.close();
  });

  test("throws on a gap in migration versions", () => {
    const db = new Database(dbPath);
    const gapped: Migration[] = [MIGRATIONS[0], { version: 3, name: "skipped v2", up: () => {} }];
    expect(() => runMigrations(db, gapped)).toThrow(/Missing database migration between v1 and v3/);
    // v1 still applied before the throw.
    expect(getSchemaVersion(db)).toBe(1);
    db.close();
  });

  test("a failing migration rolls back both its DDL and the version bump", () => {
    const db = new Database(dbPath);
    runMigrations(db);
    const failing: Migration[] = [
      ...MIGRATIONS,
      {
        version: LATEST_SCHEMA_VERSION + 1,
        name: "fails midway",
        up(d) {
          d.run("CREATE TABLE half_done (id INTEGER PRIMARY KEY)");
          throw new Error("boom");
        },
      },
    ];
    expect(() => runMigrations(db, failing)).toThrow("boom");
    expect(getSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    const halfDone = db
      .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'half_done'")
      .get();
    expect(halfDone).toBeNull();
    db.close();
  });

  test("v3 adds context_fetched_at to a pre-v3 database", () => {
    const db = new Database(dbPath);
    runMigrations(db, MIGRATIONS.slice(0, 2));
    expect(getSchemaVersion(db)).toBe(2);
    const before = db.query("PRAGMA table_info(posts)").all() as { name: string }[];
    expect(before.map((c) => c.name)).not.toContain("context_fetched_at");

    runMigrations(db);
    const after = db.query("PRAGMA table_info(posts)").all() as { name: string }[];
    expect(after.map((c) => c.name)).toContain("context_fetched_at");
    db.close();
  });

  test("v5 creates inbox_items on a pre-v5 database", () => {
    const db = new Database(dbPath);
    runMigrations(db, MIGRATIONS.slice(0, 4));
    expect(getSchemaVersion(db)).toBe(4);
    const before = db
      .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'inbox_items'")
      .get();
    expect(before).toBeNull();

    runMigrations(db);
    const cols = db.query("PRAGMA table_info(inbox_items)").all() as { name: string }[];
    const names = cols.map((c) => c.name);
    for (const expected of ["id", "name", "kind", "type", "created_utc", "is_new", "raw_json"]) {
      expect(names).toContain(expected);
    }
    db.close();
  });

  test("v6 creates job_runs on a pre-v6 database", () => {
    const db = new Database(dbPath);
    runMigrations(db, MIGRATIONS.slice(0, 5));
    expect(getSchemaVersion(db)).toBe(5);
    const before = db
      .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'job_runs'")
      .get();
    expect(before).toBeNull();

    runMigrations(db);
    const cols = db.query("PRAGMA table_info(job_runs)").all() as { name: string }[];
    const names = cols.map((c) => c.name);
    for (const expected of ["id", "started_at", "finished_at", "status", "trigger", "steps_json"]) {
      expect(names).toContain(expected);
    }
    db.close();
  });

  test("initializeSchema throws when the database is newer than the code", () => {
    const db = new Database(dbPath);
    initializeSchema(db);
    db.run("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)", [999, Date.now()]);
    db.close();

    const db2 = new Database(dbPath);
    expect(() => initializeSchema(db2)).toThrow(/newer than this code/);
    db2.close();
  });
});
