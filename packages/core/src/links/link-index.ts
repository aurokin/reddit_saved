import type { Database } from "bun:sqlite";
import type { PostRow } from "../types";
import { canonicalizeUrl, extractUrls, isRedditHost } from "./url-extract";

/**
 * Derived index of every outbound link in stored posts, maintained inside the
 * same transaction as post upserts. Fully rebuildable from the posts table —
 * it is never backed up and never a source of truth.
 *
 * created_utc mirrors the owning post's created_utc (epoch SECONDS) so
 * time-window queries don't need a join.
 */

export type LinkSource = "url" | "selftext" | "body";

export interface LinkOccurrence {
  post_id: string;
  source: LinkSource;
  position: number;
  url: string;
  canonical_url: string;
  host: string;
  /** epoch seconds, copied from the post */
  created_utc: number;
}

export interface TopLink {
  canonical_url: string;
  host: string;
  /** distinct posts referencing this link */
  postCount: number;
  /** total occurrences */
  occurrenceCount: number;
  /** epoch seconds of the newest referencing post */
  lastSeen: number;
  /** one full original URL for display/fetching */
  sampleUrl: string;
}

export interface LinkSearchRow extends LinkOccurrence {
  title: string | null;
  subreddit: string;
  permalink: string;
}

/** Extract link occurrences from one post row (pure). */
export function extractPostLinks(
  row: Pick<PostRow, "id" | "url" | "permalink" | "selftext" | "body" | "created_utc">,
): LinkOccurrence[] {
  const occurrences: LinkOccurrence[] = [];

  const push = (source: LinkSource, urls: string[]): void => {
    let position = 0;
    for (const url of urls) {
      const canonical = canonicalizeUrl(url);
      if (!canonical) continue;
      occurrences.push({
        post_id: row.id,
        source,
        position: position++,
        url,
        canonical_url: canonical.canonical,
        host: canonical.host,
        created_utc: row.created_utc,
      });
    }
  };

  // Skip self-post URLs that just point back at the post itself.
  if (
    row.url &&
    /^https?:\/\//i.test(row.url) &&
    !(row.permalink && row.url.endsWith(row.permalink))
  ) {
    push("url", [row.url]);
  }
  if (row.selftext) push("selftext", extractUrls(row.selftext));
  if (row.body) push("body", extractUrls(row.body));

  return occurrences;
}

/** Replace the indexed links for these rows. Call inside the same transaction
 *  as the post upsert so the index can never drift from the posts table. */
export function indexPostLinks(db: Database, rows: PostRow[]): void {
  if (rows.length === 0) return;
  const del = db.prepare("DELETE FROM link_occurrences WHERE post_id = ?");
  const ins = db.prepare(
    `INSERT INTO link_occurrences (post_id, source, position, url, canonical_url, host, created_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const row of rows) {
    del.run(row.id);
    for (const occ of extractPostLinks(row)) {
      ins.run(
        occ.post_id,
        occ.source,
        occ.position,
        occ.url,
        occ.canonical_url,
        occ.host,
        occ.created_utc,
      );
    }
  }
}

/** Rebuild the whole index from the posts table. Returns occurrence count. */
export function rebuildLinkIndex(db: Database): number {
  db.run("DELETE FROM link_occurrences");
  const rows = db
    .query("SELECT id, url, permalink, selftext, body, created_utc FROM posts")
    .all() as PostRow[];
  // Chunked so one prepared-statement loop doesn't hold a giant transaction
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    db.transaction(() => indexPostLinks(db, chunk))();
  }
  return (db.query("SELECT COUNT(*) AS n FROM link_occurrences").get() as { n: number }).n;
}

export interface TopLinksOptions {
  /** Only occurrences with created_utc >= this (epoch seconds) */
  since?: number;
  /** Drop reddit.com/redd.it/redditmedia hosts */
  excludeReddit?: boolean;
  limit?: number;
}

export function topLinks(db: Database, opts: TopLinksOptions = {}): TopLink[] {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (opts.since !== undefined) {
    where.push("created_utc >= ?");
    params.push(opts.since);
  }
  params.push(Math.min(opts.limit ?? 25, 1000));

  const rows = db
    .query(
      `SELECT canonical_url, host,
              COUNT(DISTINCT post_id) AS postCount,
              COUNT(*) AS occurrenceCount,
              MAX(created_utc) AS lastSeen,
              MAX(url) AS sampleUrl
       FROM link_occurrences
       ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
       GROUP BY canonical_url
       ORDER BY postCount DESC, occurrenceCount DESC, lastSeen DESC
       LIMIT ?`,
    )
    .all(...params) as TopLink[];

  return opts.excludeReddit ? rows.filter((r) => !isRedditHost(r.host)) : rows;
}

export interface SearchLinksOptions {
  limit?: number;
}

/** Substring search over indexed URLs (canonical and original). */
export function searchLinks(
  db: Database,
  pattern: string,
  opts: SearchLinksOptions = {},
): LinkSearchRow[] {
  const like = `%${pattern.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  return db
    .query(
      `SELECT lo.*, p.title, p.subreddit, p.permalink
       FROM link_occurrences lo
       JOIN posts p ON p.id = lo.post_id
       WHERE lo.canonical_url LIKE ? ESCAPE '\\' OR lo.url LIKE ? ESCAPE '\\'
       ORDER BY lo.created_utc DESC
       LIMIT ?`,
    )
    .all(like, like, Math.min(opts.limit ?? 25, 1000)) as LinkSearchRow[];
}
