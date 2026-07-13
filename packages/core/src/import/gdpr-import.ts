import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RedditApiClient } from "../api/client";
import { INFO_BATCH_MAX } from "../api/endpoints";
import { CONTENT_ORIGINS } from "../constants";
import type { SqliteAdapter } from "../storage/sqlite-adapter";
import type { ContentOrigin, RedditItem } from "../types";
import { parseCsvRecords } from "./csv";

/**
 * GDPR data-export import: backfill the archive from the CSVs in an unzipped
 * Reddit data request (reddit.com/settings/data-request), reaching past
 * Reddit's ~1000-item listing cap.
 *
 * The CSVs carry bare ids + permalinks (no content), so imported items are
 * hydrated via /api/info. Fullnames already in the posts table are skipped
 * entirely — the export data is strictly poorer than what a sync stored.
 * Fullnames Reddit no longer knows are stored as minimal stubs and flipped
 * to is_on_reddit = 0 (honestly marked not-on-Reddit).
 *
 * Imports are NOT syncs: no sync_runs rows are written. fetched_at stamping
 * by upsertPosts is intentional — imported items show as new-to-archive in
 * the today digest.
 */

export interface GdprImportOptions {
  /** Directory containing the unzipped Reddit GDPR export CSVs */
  dir: string;
  /** Restrict the import to these origins (default: all four) */
  types?: ContentOrigin[];
  /** Cap the number of rows considered per origin (applied after in-file dedupe) */
  limit?: number;
  /** Parse, dedupe, and count only — no network calls, no writes. The
   *  read-only already-in-archive check still runs so alreadyPresent is
   *  accurate. hydrated/deletedStubs report 0. */
  dryRun?: boolean;
  signal?: AbortSignal;
  /** Hydration progress per origin: processed / total missing fullnames */
  onProgress?: (origin: ContentOrigin, processed: number, total: number) => void;
}

export interface GdprImportOriginResult {
  origin: ContentOrigin;
  /** Distinct fullnames found in this origin's CSVs */
  found: number;
  /** Skipped — already in the posts table */
  alreadyPresent: number;
  /** Hydrated from /api/info and upserted */
  hydrated: number;
  /** Deleted on Reddit — stored as stubs and marked not-on-Reddit */
  deletedStubs: number;
}

export interface GdprImportResult {
  perOrigin: GdprImportOriginResult[];
  wasCancelled: boolean;
}

interface CsvSpec {
  file: string;
  kind: "t1" | "t3";
  /** Keep only rows passing this predicate (e.g. upvotes from post_votes.csv) */
  rowFilter?: (record: Record<string, string>) => boolean;
}

/** Known export CSVs per origin. Column positions are never assumed — the
 *  header row is the source of truth (columns are located by name). */
const ORIGIN_CSVS: Record<ContentOrigin, CsvSpec[]> = {
  saved: [
    { file: "saved_posts.csv", kind: "t3" },
    { file: "saved_comments.csv", kind: "t1" },
  ],
  upvoted: [{ file: "post_votes.csv", kind: "t3", rowFilter: (r) => r.direction === "up" }],
  submitted: [{ file: "posts.csv", kind: "t3" }],
  commented: [{ file: "comments.csv", kind: "t1" }],
};

/** One CSV row normalized: bare id, derived fullname, permalink for stubs. */
interface CsvEntry {
  id: string;
  fullname: string;
  kind: "t1" | "t3";
  permalink: string;
}

export async function importGdprExport(
  storage: SqliteAdapter,
  api: RedditApiClient | null,
  options: GdprImportOptions,
): Promise<GdprImportResult> {
  const { dir, limit, dryRun, signal, onProgress } = options;
  const origins = options.types ?? CONTENT_ORIGINS;
  if (!dryRun && !api) {
    throw new Error("importGdprExport requires an API client unless dryRun is set");
  }

  const result: GdprImportResult = { perOrigin: [], wasCancelled: false };

  // Keep CONTENT_ORIGINS order regardless of the types filter's order
  for (const origin of CONTENT_ORIGINS) {
    if (!origins.includes(origin)) continue;
    if (result.wasCancelled) break;

    const specs = ORIGIN_CSVS[origin].filter((spec) => existsSync(join(dir, spec.file)));
    if (specs.length === 0) continue;

    let entries: CsvEntry[] = [];
    const seen = new Set<string>();
    for (const spec of specs) {
      const text = readFileSync(join(dir, spec.file), "utf8");
      for (const record of parseCsvRecords(text)) {
        if (spec.rowFilter && !spec.rowFilter(record)) continue;
        const id = record.id;
        if (id === undefined) {
          throw new Error(`${spec.file}: missing "id" column in header row`);
        }
        if (!id) continue;
        const fullname = `${spec.kind}_${id}`;
        if (seen.has(fullname)) continue;
        seen.add(fullname);
        entries.push({ id, fullname, kind: spec.kind, permalink: record.permalink ?? "" });
      }
    }
    if (limit !== undefined) entries = entries.slice(0, limit);

    const existing = storage.getExistingPostNames(entries.map((e) => e.fullname));
    const missing = entries.filter((e) => !existing.has(e.fullname));

    const originResult: GdprImportOriginResult = {
      origin,
      found: entries.length,
      alreadyPresent: entries.length - missing.length,
      hydrated: 0,
      deletedStubs: 0,
    };
    result.perOrigin.push(originResult);

    if (dryRun) continue;

    // Hydrate missing fullnames in batches of 100 (one /api/info call each),
    // upserting per batch so progress survives cancellation.
    for (let i = 0; i < missing.length; i += INFO_BATCH_MAX) {
      if (signal?.aborted) {
        result.wasCancelled = true;
        break;
      }
      const batch = missing.slice(i, i + INFO_BATCH_MAX);
      const items = await (api as RedditApiClient).fetchItemsByFullnames(
        batch.map((e) => e.fullname),
        signal,
      );
      if (items.length > 0) {
        storage.upsertPosts(items, origin);
      }

      // Fullnames absent from the /api/info response are deleted on Reddit:
      // store an honest stub and flip it orphaned.
      const returned = new Set(items.map((item) => item.data.name));
      const deleted = batch.filter((e) => !returned.has(e.fullname));
      if (deleted.length > 0) {
        storage.upsertPosts(deleted.map(buildDeletedStub), origin);
        storage.markUnsaved(deleted.map((e) => e.id));
      }

      originResult.hydrated += batch.length - deleted.length;
      originResult.deletedStubs += deleted.length;
      onProgress?.(origin, Math.min(i + batch.length, missing.length), missing.length);
    }
  }

  return result;
}

/** Minimal stub for content Reddit no longer serves — enough for the row to
 *  exist and be searchable by permalink/subreddit. */
function buildDeletedStub(entry: CsvEntry): RedditItem {
  const permalink = permalinkPath(entry.permalink);
  return {
    kind: entry.kind,
    data: {
      id: entry.id,
      name: entry.fullname,
      permalink,
      subreddit: subredditFromPermalink(permalink),
      author: "[deleted]",
      created_utc: 0, // epoch seconds — unknown
      score: 0,
      ...(entry.kind === "t3" ? { title: "[deleted]" } : { body: "[deleted]" }),
    },
  };
}

/** Export CSVs store permalinks as full URLs; posts rows store paths. */
function permalinkPath(permalink: string): string {
  if (/^https?:\/\//.test(permalink)) {
    try {
      return new URL(permalink).pathname;
    } catch {
      return permalink;
    }
  }
  return permalink;
}

function subredditFromPermalink(path: string): string {
  const match = /^\/r\/([^/]+)\//.exec(path);
  return match ? match[1] : "[unknown]";
}
