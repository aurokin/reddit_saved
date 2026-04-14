import { Database, type SQLQueryBindings } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  ContentOrigin,
  DbStats,
  ListOptions,
  PostRow,
  RedditItem,
  SearchOptions,
  SearchResult,
  StorageAdapter,
} from "../types";
import { paths } from "../utils/paths";
import { mapRedditItemToRow } from "./mapper";
import {
  assertFts5Available as assertFts5,
  createFtsTriggers,
  dropFtsTriggers,
  initializeSchema,
  rebuildFtsIndex as rebuildFts,
} from "./schema";

type BindValue = string | number | bigint | boolean | null;
type BindRecord = Record<string, BindValue>;

/** Subquery for tag filtering — used in both listPosts and searchPosts.
 *  Uses EXISTS with explicit post_id reference to avoid coupling to the outer query alias. */
const TAG_FILTER_SQL =
  "EXISTS (SELECT 1 FROM post_tags pt2 JOIN tags t2 ON t2.id = pt2.tag_id WHERE pt2.post_id = p.id AND t2.name = ?)";

export class SqliteAdapter implements StorageAdapter {
  private db: Database;

  constructor(dbPath?: string) {
    const p = dbPath ?? paths.database;
    mkdirSync(dirname(p), { recursive: true });
    this.db = new Database(p);
    initializeSchema(this.db);
    assertFts5(this.db);
    // Crash recovery: rebuild FTS only if triggers were missing (unclean shutdown).
    // Check if triggers exist; if not, recreate and rebuild.
    this.ensureFtsConsistency();
  }

  /** Expose the raw Database handle (for TagManager) */
  getDb(): Database {
    return this.db;
  }

  // --------------------------------------------------------------------------
  // Posts
  // --------------------------------------------------------------------------

  upsertPosts(items: RedditItem[], origin: ContentOrigin): void {
    if (items.length === 0) return;

    const rows = items.map((item) => mapRedditItemToRow(item, origin));
    const BULK_THRESHOLD = 500;
    const useBulk = rows.length >= BULK_THRESHOLD;

    // Bulk strategy: drop triggers → insert → recreate triggers → rebuild FTS.
    // Small batches: keep triggers active so FTS is maintained incrementally.
    // SQLite DDL is transactional — rollback restores triggers automatically.
    this.db.transaction(() => {
      if (useBulk) dropFtsTriggers(this.db);
      const upsert = this.db.prepare(`
        INSERT INTO posts (
          id, name, kind, content_origin, title, author, subreddit, permalink,
          url, domain, selftext, body, score, created_utc, num_comments,
          upvote_ratio, is_self, over_18, is_video, is_gallery, post_hint,
          link_flair_text, thumbnail, preview_url,
          parent_id, link_id, link_title, link_permalink, is_submitter,
          distinguished, edited, stickied, spoiler, locked, archived,
          fetched_at, updated_at, is_on_reddit, last_seen_at, raw_json
        ) VALUES (
          $id, $name, $kind, $content_origin, $title, $author, $subreddit, $permalink,
          $url, $domain, $selftext, $body, $score, $created_utc, $num_comments,
          $upvote_ratio, $is_self, $over_18, $is_video, $is_gallery, $post_hint,
          $link_flair_text, $thumbnail, $preview_url,
          $parent_id, $link_id, $link_title, $link_permalink, $is_submitter,
          $distinguished, $edited, $stickied, $spoiler, $locked, $archived,
          $fetched_at, $updated_at, $is_on_reddit, $last_seen_at, $raw_json
        )
        -- content_origin intentionally omitted: first-write-wins preserves how the item was originally fetched
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          selftext = excluded.selftext,
          body = excluded.body,
          score = excluded.score,
          num_comments = excluded.num_comments,
          upvote_ratio = excluded.upvote_ratio,
          over_18 = excluded.over_18,
          link_flair_text = excluded.link_flair_text,
          thumbnail = excluded.thumbnail,
          preview_url = excluded.preview_url,
          distinguished = excluded.distinguished,
          edited = excluded.edited,
          stickied = excluded.stickied,
          spoiler = excluded.spoiler,
          locked = excluded.locked,
          archived = excluded.archived,
          updated_at = excluded.updated_at,
          is_on_reddit = 1,
          last_seen_at = excluded.last_seen_at,
          raw_json = excluded.raw_json
      `);
      for (const row of rows) {
        upsert.run(rowToBindRecord(row));
      }
      if (useBulk) {
        createFtsTriggers(this.db);
        rebuildFts(this.db);
      }
    })();
  }

  getPost(id: string): PostRow | null {
    return (
      (this.db
        .query(
          `SELECT p.*, GROUP_CONCAT(t.name, '||') AS tags
           FROM posts p
           LEFT JOIN post_tags pt ON pt.post_id = p.id
           LEFT JOIN tags t ON t.id = pt.tag_id
           WHERE p.id = ?
           GROUP BY p.id`,
        )
        .get(id) as PostRow | null) ?? null
    );
  }

  listPosts(opts: ListOptions): PostRow[] {
    const where: string[] = [];
    const params: BindValue[] = [];

    if (opts.orphaned === true) {
      where.push("p.is_on_reddit = 0");
    } else if (opts.orphaned !== "all") {
      where.push("p.is_on_reddit = 1");
    }

    if (opts.subreddit) {
      where.push("p.subreddit = ?");
      params.push(opts.subreddit);
    }
    if (opts.author) {
      where.push("p.author = ?");
      params.push(opts.author);
    }
    if (opts.minScore !== undefined) {
      where.push("p.score >= ?");
      params.push(opts.minScore);
    }
    if (opts.kind) {
      where.push("p.kind = ?");
      params.push(opts.kind);
    }
    if (opts.contentOrigin) {
      where.push("p.content_origin = ?");
      params.push(opts.contentOrigin);
    }

    if (opts.tag) {
      where.push(TAG_FILTER_SQL);
      params.push(opts.tag);
    }

    const sortCol = opts.sort === "score" ? "p.score" : "p.created_utc";
    const sortDir = opts.sortDirection === "asc" ? "ASC" : "DESC";
    params.push(Math.min(opts.limit ?? 50, 10_000), opts.offset ?? 0);

    const sql = `
      SELECT p.*, GROUP_CONCAT(t.name, '||') AS tags
      FROM posts p
      LEFT JOIN post_tags pt ON pt.post_id = p.id
      LEFT JOIN tags t ON t.id = pt.tag_id
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      GROUP BY p.id
      ORDER BY ${sortCol} ${sortDir}
      LIMIT ? OFFSET ?
    `;

    return this.db.query(sql).all(...(params as SQLQueryBindings[])) as PostRow[];
  }

  searchPosts(query: string, opts: SearchOptions): SearchResult[] {
    if (!query.trim()) return [];

    // Sanitize for FTS5: keep only letters, digits, and whitespace, then wrap
    // as a double-quoted phrase literal. This prevents any FTS5 operator or
    // structural character (", *, ^, parentheses, OR/AND/NOT, etc.) from leaking.
    const cleaned = query
      .replace(/[^\p{L}\p{N}\s\-']/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) return [];
    const safeQuery = `"${cleaned}"`;

    const where: string[] = ["posts_fts MATCH ?"];
    const params: BindValue[] = [safeQuery];

    if (opts.orphaned === true) {
      where.push("p.is_on_reddit = 0");
    } else if (opts.orphaned !== "all") {
      where.push("p.is_on_reddit = 1");
    }
    if (opts.subreddit) {
      where.push("p.subreddit = ?");
      params.push(opts.subreddit);
    }
    if (opts.author) {
      where.push("p.author = ?");
      params.push(opts.author);
    }
    if (opts.minScore !== undefined) {
      where.push("p.score >= ?");
      params.push(opts.minScore);
    }
    if (opts.kind) {
      where.push("p.kind = ?");
      params.push(opts.kind);
    }
    if (opts.createdAfter !== undefined) {
      where.push("p.created_utc >= ?");
      params.push(opts.createdAfter);
    }
    if (opts.createdBefore !== undefined) {
      where.push("p.created_utc <= ?");
      params.push(opts.createdBefore);
    }

    if (opts.tag) {
      where.push(TAG_FILTER_SQL);
      params.push(opts.tag);
    }

    params.push(Math.min(opts.limit ?? 50, 10_000), opts.offset ?? 0);

    // Use a correlated subquery for tags instead of JOIN + GROUP BY, because
    // FTS5 auxiliary functions (bm25, snippet) require direct FTS table context.
    const sql = `
      SELECT p.*,
        (SELECT GROUP_CONCAT(t.name, '||') FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.post_id = p.id) AS tags,
        coalesce(
          snippet(posts_fts, 0, '<b>', '</b>', '...', 32),
          snippet(posts_fts, 2, '<b>', '</b>', '...', 32),
          snippet(posts_fts, 1, '<b>', '</b>', '...', 32)
        ) AS snippet,
        bm25(posts_fts) AS rank
      FROM posts_fts
      JOIN posts p ON posts_fts.rowid = p.rowid
      WHERE ${where.join(" AND ")}
      ORDER BY rank
      LIMIT ? OFFSET ?
    `;

    try {
      return this.db.query(sql).all(...(params as SQLQueryBindings[])) as SearchResult[];
    } catch (err) {
      // Belt-and-suspenders: the Unicode whitelist sanitization above should prevent
      // all FTS5 parse errors, but catch them defensively in case of edge cases.
      // Re-throw non-FTS errors (disk I/O, corruption) so callers see real failures.
      const msg = err instanceof Error ? err.message : String(err);
      if (/fts5: syntax error|malformed MATCH expression/i.test(msg)) {
        return [];
      }
      throw err;
    }
  }

  markOrphaned(olderThan: number, origin?: ContentOrigin): number {
    if (olderThan < 1_000_000_000_000) {
      throw new Error("markOrphaned expects epoch milliseconds (Date.now()), not seconds");
    }
    if (origin) {
      const rows = this.db
        .query(
          "UPDATE posts SET is_on_reddit = 0 WHERE is_on_reddit = 1 AND last_seen_at < ? AND content_origin = ? RETURNING id",
        )
        .all(olderThan, origin) as Array<{ id: string }>;
      return rows.length;
    }
    const rows = this.db
      .query(
        "UPDATE posts SET is_on_reddit = 0 WHERE is_on_reddit = 1 AND last_seen_at < ? RETURNING id",
      )
      .all(olderThan) as Array<{ id: string }>;
    return rows.length;
  }

  getStats(): DbStats {
    const totals = this.db
      .query(
        `SELECT
          SUM(CASE WHEN kind = 't3' THEN 1 ELSE 0 END) AS totalPosts,
          SUM(CASE WHEN kind = 't1' THEN 1 ELSE 0 END) AS totalComments,
          SUM(CASE WHEN is_on_reddit = 0 THEN 1 ELSE 0 END) AS orphanedCount,
          MIN(created_utc) AS oldestItem,
          MAX(created_utc) AS newestItem
        FROM posts`,
      )
      .get() as Record<string, number | null>;

    const originRows = this.db
      .query(
        `SELECT content_origin, COUNT(*) AS count FROM posts
         WHERE is_on_reddit = 1
         GROUP BY content_origin`,
      )
      .all() as Array<{ content_origin: string; count: number }>;

    const activeCountByOrigin: Record<ContentOrigin, number> = {
      saved: 0,
      upvoted: 0,
      submitted: 0,
      commented: 0,
    };
    for (const row of originRows) {
      if (row.content_origin in activeCountByOrigin) {
        activeCountByOrigin[row.content_origin as ContentOrigin] = row.count;
      }
    }

    const subredditCounts = this.db
      .query(
        `SELECT subreddit, COUNT(*) AS count FROM posts WHERE is_on_reddit = 1
         GROUP BY subreddit ORDER BY count DESC`,
      )
      .all() as Array<{ subreddit: string; count: number }>;

    const tagCounts = this.db
      .query(
        `SELECT t.name, COUNT(p.id) AS count FROM tags t
         LEFT JOIN post_tags pt ON pt.tag_id = t.id
         LEFT JOIN posts p ON p.id = pt.post_id AND p.is_on_reddit = 1
         GROUP BY t.id ORDER BY count DESC`,
      )
      .all() as Array<{ name: string; count: number }>;

    const lastSync = this.db
      .query("SELECT value FROM sync_state WHERE key = 'last_sync_time'")
      .get() as { value: string } | null;

    return {
      totalPosts: totals.totalPosts ?? 0,
      totalComments: totals.totalComments ?? 0,
      orphanedCount: totals.orphanedCount ?? 0,
      activeCountByOrigin,
      subredditCounts,
      tagCounts,
      oldestItem: totals.oldestItem ?? null,
      newestItem: totals.newestItem ?? null,
      lastSyncTime: lastSync ? Number.parseInt(lastSync.value, 10) : null,
    };
  }

  // --------------------------------------------------------------------------
  // Sync state
  // --------------------------------------------------------------------------

  getSyncState(key: string): string | null {
    const row = this.db.query("SELECT value FROM sync_state WHERE key = ?").get(key) as {
      value: string;
    } | null;
    return row?.value ?? null;
  }

  setSyncState(key: string, value: string): void {
    this.db.run(
      `INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, value, Date.now()],
    );
  }

  deleteSyncState(key: string): void {
    this.db.run("DELETE FROM sync_state WHERE key = ?", [key]);
  }

  // --------------------------------------------------------------------------
  // Unsave
  // --------------------------------------------------------------------------

  markUnsaved(ids: string[]): void {
    if (ids.length === 0) return;
    // Chunk to stay under SQLite's variable limit (999)
    this.db.transaction(() => {
      const CHUNK_SIZE = 900;
      for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        const chunk = ids.slice(i, i + CHUNK_SIZE);
        const placeholders = chunk.map(() => "?").join(",");
        this.db
          .query(`UPDATE posts SET is_on_reddit = 0 WHERE id IN (${placeholders})`)
          .run(...(chunk as SQLQueryBindings[]));
      }
    })();
  }

  // --------------------------------------------------------------------------
  // Maintenance
  // --------------------------------------------------------------------------

  rebuildFtsIndex(): void {
    rebuildFts(this.db);
  }

  assertFts5Available(): void {
    assertFts5(this.db);
  }

  close(): void {
    this.db.close();
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  /** Ensure FTS triggers exist and index is consistent.
   * Checks trigger presence first, then runs FTS5 integrity-check to catch stale indexes. */
  private ensureFtsConsistency(): void {
    const triggerCount = (
      this.db
        .query(
          "SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type = 'trigger' AND name IN ('posts_ai', 'posts_ad', 'posts_au')",
        )
        .get() as { cnt: number }
    ).cnt;

    let needsRebuild = triggerCount < 3;
    if (!needsRebuild) {
      try {
        this.db.run("INSERT INTO posts_fts(posts_fts) VALUES('integrity-check')");
      } catch {
        needsRebuild = true;
      }
    }
    if (needsRebuild) {
      this.db.transaction(() => {
        dropFtsTriggers(this.db);
        createFtsTriggers(this.db);
        rebuildFts(this.db);
      })();
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function rowToBindRecord(row: PostRow): BindRecord {
  return {
    $id: row.id,
    $name: row.name,
    $kind: row.kind,
    $content_origin: row.content_origin,
    $title: row.title,
    $author: row.author,
    $subreddit: row.subreddit,
    $permalink: row.permalink,
    $url: row.url,
    $domain: row.domain,
    $selftext: row.selftext,
    $body: row.body,
    $score: row.score,
    $created_utc: row.created_utc,
    $num_comments: row.num_comments,
    $upvote_ratio: row.upvote_ratio,
    $is_self: row.is_self,
    $over_18: row.over_18,
    $is_video: row.is_video,
    $is_gallery: row.is_gallery,
    $post_hint: row.post_hint,
    $link_flair_text: row.link_flair_text,
    $thumbnail: row.thumbnail,
    $preview_url: row.preview_url,
    $parent_id: row.parent_id,
    $link_id: row.link_id,
    $link_title: row.link_title,
    $link_permalink: row.link_permalink,
    $is_submitter: row.is_submitter,
    $distinguished: row.distinguished,
    $edited: row.edited,
    $stickied: row.stickied,
    $spoiler: row.spoiler,
    $locked: row.locked,
    $archived: row.archived,
    $fetched_at: row.fetched_at,
    $updated_at: row.updated_at,
    $is_on_reddit: row.is_on_reddit,
    $last_seen_at: row.last_seen_at,
    $raw_json: row.raw_json,
  };
}
