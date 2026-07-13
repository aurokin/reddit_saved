import { createHash } from "node:crypto";
import { mkdirSync, readdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { SqliteAdapter } from "../storage/sqlite-adapter";

/**
 * Deterministic JSONL backup of the source-of-truth tables.
 *
 * Layout inside the backup repo:
 *   data/posts/<YYYY>.jsonl   — posts sharded by UTC year of created_utc
 *   data/posts/unknown.jsonl  — rows with an unusable created_utc
 *   data/tags.jsonl
 *   data/post_tags.jsonl
 *   data/sync_state.jsonl
 *   manifest.json             — per-file rows/bytes/sha256 + overall backupHash
 *
 * Determinism contract: rows ordered by primary key, JSON keys sorted, one
 * object per line, no timestamps in the manifest — the same database state
 * always produces byte-identical output, so an unchanged second sync yields
 * no git commit.
 *
 * Derived state (link_occurrences, FTS tables, sync_runs provenance) is
 * excluded: it is rebuilt from these tables, not restored.
 */

export interface BackupFileEntry {
  /** Repo-relative path with forward slashes */
  path: string;
  rows: number;
  bytes: number;
  sha256: string;
}

export interface BackupManifest {
  version: 1;
  files: BackupFileEntry[];
  /** Hash over the file table — a cheap equality check between two backups */
  backupHash: string;
}

export interface BackupPlanFile {
  path: string;
  content: string;
  rows: number;
}

export interface BackupWriteResult {
  manifest: BackupManifest;
  written: string[];
  unchanged: string[];
  removed: string[];
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** JSON.stringify with recursively sorted object keys. */
export function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalStringify(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function toJsonl(rows: Array<Record<string, unknown>>): string {
  return rows.map((row) => `${canonicalStringify(row)}\n`).join("");
}

function postYearShard(createdUtc: unknown): string {
  if (typeof createdUtc !== "number" || !Number.isFinite(createdUtc) || createdUtc <= 0) {
    return "unknown";
  }
  const year = new Date(createdUtc * 1000).getUTCFullYear();
  if (year < 2005 || year > 2100) return "unknown";
  return String(year);
}

/** Serialize the whole backup in memory (pure read of the database). */
export function buildBackupPlan(storage: SqliteAdapter): BackupPlanFile[] {
  const db = storage.getDb();
  const files: BackupPlanFile[] = [];

  const posts = db.query("SELECT * FROM posts ORDER BY id ASC").all() as Array<
    Record<string, unknown>
  >;
  const shards = new Map<string, Array<Record<string, unknown>>>();
  for (const row of posts) {
    const shard = postYearShard(row.created_utc);
    let bucket = shards.get(shard);
    if (!bucket) {
      bucket = [];
      shards.set(shard, bucket);
    }
    bucket.push(row);
  }
  for (const shard of [...shards.keys()].sort()) {
    const rows = shards.get(shard) as Array<Record<string, unknown>>;
    files.push({ path: `data/posts/${shard}.jsonl`, content: toJsonl(rows), rows: rows.length });
  }

  const tables: Array<{ path: string; sql: string }> = [
    { path: "data/tags.jsonl", sql: "SELECT * FROM tags ORDER BY id ASC" },
    { path: "data/post_tags.jsonl", sql: "SELECT * FROM post_tags ORDER BY post_id, tag_id" },
    { path: "data/sync_state.jsonl", sql: "SELECT * FROM sync_state ORDER BY key ASC" },
  ];
  for (const table of tables) {
    const rows = db.query(table.sql).all() as Array<Record<string, unknown>>;
    files.push({ path: table.path, content: toJsonl(rows), rows: rows.length });
  }

  return files;
}

export function buildManifest(files: BackupPlanFile[]): BackupManifest {
  const entries: BackupFileEntry[] = files
    .map((f) => ({
      path: f.path,
      rows: f.rows,
      bytes: Buffer.byteLength(f.content),
      sha256: sha256(f.content),
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const backupHash = sha256(
    entries.map((e) => `${e.path}\t${e.rows}\t${e.bytes}\t${e.sha256}`).join("\n"),
  );

  return { version: 1, files: entries, backupHash };
}

export async function readManifest(repoPath: string): Promise<BackupManifest | null> {
  const file = Bun.file(join(repoPath, "manifest.json"));
  if (!(await file.exists())) return null;
  try {
    return (await file.json()) as BackupManifest;
  } catch {
    return null;
  }
}

/** Write the backup into repoPath: only-if-changed per file, stale post
 *  shards removed, manifest.json refreshed. */
export async function writeBackup(
  storage: SqliteAdapter,
  repoPath: string,
): Promise<BackupWriteResult> {
  const files = buildBackupPlan(storage);
  const manifest = buildManifest(files);

  const written: string[] = [];
  const unchanged: string[] = [];
  const removed: string[] = [];

  mkdirSync(join(repoPath, "data", "posts"), { recursive: true });

  for (const file of files) {
    const absolute = join(repoPath, file.path);
    const existing = Bun.file(absolute);
    if ((await existing.exists()) && (await existing.text()) === file.content) {
      unchanged.push(file.path);
    } else {
      await Bun.write(absolute, file.content);
      written.push(file.path);
    }
  }

  // Remove stale post shards (a shard disappears if all its rows were deleted)
  const expected = new Set(files.map((f) => f.path));
  for (const entry of readdirSync(join(repoPath, "data", "posts"))) {
    if (!entry.endsWith(".jsonl")) continue;
    const rel = `data/posts/${entry}`;
    if (!expected.has(rel)) {
      await unlink(join(repoPath, "data", "posts", entry));
      removed.push(rel);
    }
  }

  const manifestContent = `${canonicalStringify(manifest)}\n`;
  const manifestPath = join(repoPath, "manifest.json");
  const existingManifest = Bun.file(manifestPath);
  if (!((await existingManifest.exists()) && (await existingManifest.text()) === manifestContent)) {
    await Bun.write(manifestPath, manifestContent);
    // manifest.json itself is not listed in the manifest
    if (written.length === 0 && removed.length === 0) written.push("manifest.json");
  }

  return { manifest, written, unchanged, removed };
}

export interface BackupStatus {
  repoPath: string;
  /** Manifest currently on disk in the repo, if any */
  repoManifest: BackupManifest | null;
  /** What a backup of the current database would produce */
  currentManifest: BackupManifest;
  upToDate: boolean;
  /** Repo-relative paths that would change on the next sync */
  pendingChanges: string[];
}

export async function backupStatus(
  storage: SqliteAdapter,
  repoPath: string,
): Promise<BackupStatus> {
  const currentManifest = buildManifest(buildBackupPlan(storage));
  const repoManifest = await readManifest(repoPath);

  const pendingChanges: string[] = [];
  const repoByPath = new Map((repoManifest?.files ?? []).map((f) => [f.path, f.sha256]));
  for (const file of currentManifest.files) {
    if (repoByPath.get(file.path) !== file.sha256) pendingChanges.push(file.path);
    repoByPath.delete(file.path);
  }
  pendingChanges.push(...repoByPath.keys()); // files that would be removed

  return {
    repoPath: resolve(repoPath),
    repoManifest,
    currentManifest,
    upToDate: repoManifest?.backupHash === currentManifest.backupHash,
    pendingChanges,
  };
}
