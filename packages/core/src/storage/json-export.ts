import type { ListOptions, PostRow, StorageAdapter } from "../types";

export interface ExportOptions {
  subreddit?: string;
  tag?: string;
  /**
   * Filter by orphaned status.
   * - `true`: only orphaned posts
   * - `false` or omitted: only non-orphaned posts (adapter default)
   *
   * There is no way to export both orphaned and non-orphaned in a single call;
   * make two calls and merge if needed.
   */
  orphaned?: boolean;
  kind?: "t1" | "t3";
  /** Max rows to export. Defaults to unlimited (paginates through all results).
   *  A value of `0` returns zero rows — pass `undefined` for unlimited. */
  limit?: number;
  /** Include raw_json field in JSON export (default: false) */
  includeRawJson?: boolean;
}

export interface ExportMetadata {
  exportedAt: string;
  count: number;
}

// ============================================================================
// JSON
// ============================================================================

export function exportToJson(adapter: StorageAdapter, opts?: ExportOptions): string {
  const rows = fetchRows(adapter, opts);
  const includeRaw = opts?.includeRawJson ?? false;

  // Normalize tags from DB's "||" delimiter to array, and optionally strip raw_json
  const posts = rows.map(({ raw_json: _, tags, ...rest }) => ({
    ...rest,
    tags: tags ? tags.split("||").map((t: string) => t.trim()) : [],
    ...(includeRaw ? { raw_json: _ } : {}),
  }));

  const output: ExportMetadata & { posts: unknown[] } = {
    exportedAt: new Date().toISOString(),
    count: posts.length,
    posts,
  };

  return JSON.stringify(output, null, 2);
}

// ============================================================================
// CSV (RFC 4180)
// ============================================================================

const CSV_FIELDS: Array<keyof PostRow> = [
  "id",
  "kind",
  "title",
  "author",
  "subreddit",
  "score",
  "created_utc",
  "permalink",
  "url",
  "tags",
];

export function exportToCsv(adapter: StorageAdapter, opts?: ExportOptions): string {
  const rows = fetchRows(adapter, opts);
  const lines: string[] = [CSV_FIELDS.map(csvEscape).join(",")];

  for (const row of rows) {
    const values = CSV_FIELDS.map((field) => {
      const raw = row[field];
      // Normalize tags from DB's || delimiter to comma-separated
      if (field === "tags" && typeof raw === "string") {
        return csvEscape(raw.split("||").join(", "));
      }
      return csvEscape(raw);
    });
    lines.push(values.join(","));
  }

  // RFC 4180 §2: CRLF line terminators, including trailing CRLF on last record
  return `${lines.join("\r\n")}\r\n`;
}

/** Characters that spreadsheet apps interpret as formula prefixes */
const CSV_FORMULA_PREFIX = /^[=+\-@\t]/;

function csvEscape(value: unknown): string {
  if (value == null) return "";
  const str = String(value);
  if (
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r") ||
    str.includes("\t") ||
    CSV_FORMULA_PREFIX.test(str)
  ) {
    // Normalize all line ending variants (CRLF, bare CR, bare LF) to CRLF
    const normalized = str.replace(/\r\n|\r|\n/g, "\r\n");
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Strip Markdown-significant characters from a field value (defensive).
 *  Underscore is intentionally kept — it's legal in Reddit usernames/subreddits
 *  and harmless in the list-item context where this is used. */
function sanitizeMdField(str: string): string {
  return str.replace(/[[\]()`#*~\\>|{}]/g, "");
}

// ============================================================================
// Markdown
// ============================================================================

export function exportToMarkdown(adapter: StorageAdapter, opts?: ExportOptions): string {
  const rows = fetchRows(adapter, opts);
  const sections: string[] = [
    "# Reddit Saved Export",
    "",
    `Exported: ${new Date().toISOString()} | ${rows.length} items`,
    "",
  ];

  for (const row of rows) {
    const rawTitle = row.title || (row.body ? `Comment by ${row.author}` : row.id);
    // Sanitize title: strip newlines and Markdown link/heading metacharacters
    const title = sanitizeMdField(rawTitle.replace(/[\r\n]+/g, " "));
    // Percent-encode `>` to prevent early termination of the angle-bracket autolink.
    // Null-guard defensively — SQLite adapter casts rows via `as PostRow`.
    const safePermalink = (row.permalink ?? "").replace(/>/g, "%3E");
    const redditUrl = safePermalink ? `https://reddit.com${safePermalink}` : "";
    const dateStr =
      row.created_utc && Number.isFinite(row.created_utc)
        ? new Date(row.created_utc * 1000).toISOString().split("T")[0]
        : "unknown";
    sections.push(`## ${title}`);
    sections.push("");
    sections.push(`- **Subreddit:** r/${sanitizeMdField(row.subreddit)}`);
    sections.push(`- **Author:** u/${sanitizeMdField(row.author)}`);
    sections.push(`- **Score:** ${row.score ?? 0}`);
    sections.push(`- **Date:** ${dateStr}`);
    // Wrap URL in angle brackets to make it a literal autolink (prevents injection).
    // Outbound URLs (row.url) need the same treatment if ever added here.
    if (redditUrl) {
      sections.push(`- **Link:** <${redditUrl}>`);
    }
    if (row.tags) {
      const safeTags = row.tags
        .split("||")
        .map((t: string) => sanitizeMdField(t.trim()))
        .join(", ");
      sections.push(`- **Tags:** ${safeTags}`);
    }
    sections.push("");

    const content = row.selftext || row.body;
    if (content) {
      // Blockquote user content to prevent Markdown structural injection
      // (e.g. ## headings, --- separators, or fake metadata lines).
      // Normalize line endings first so \r\n and \r are handled consistently.
      const quoted = content
        .replace(/\r\n|\r/g, "\n")
        .split("\n")
        .map((line: string) => `> ${line}`)
        .join("\n");
      sections.push(quoted);
      sections.push("");
    }

    sections.push("---");
    sections.push("");
  }

  return sections.join("\n");
}

// ============================================================================
// Shared
// ============================================================================

/** Page size for fetching rows — adapter caps at 10,000 per query */
const FETCH_PAGE_SIZE = 10_000;

/**
 * Fetch all matching rows, paginating through the adapter's per-query cap.
 * This ensures exports are not silently truncated at 10,000 rows.
 */
function fetchRows(adapter: StorageAdapter, opts?: ExportOptions): PostRow[] {
  const maxRows = opts?.limit != null && opts.limit > 0 ? opts.limit : Number.POSITIVE_INFINITY;
  const allRows: PostRow[] = [];

  while (allRows.length < maxRows) {
    const pageLimit = Math.min(FETCH_PAGE_SIZE, maxRows - allRows.length);
    const listOpts: ListOptions = {
      limit: pageLimit,
      offset: allRows.length,
      subreddit: opts?.subreddit,
      tag: opts?.tag,
      orphaned: opts?.orphaned,
      kind: opts?.kind,
    };
    const page = adapter.listPosts(listOpts);
    if (page.length === 0) break; // defensive: never spin on a broken adapter
    allRows.push(...page);
    if (page.length < pageLimit) break; // last page
  }

  return allRows;
}
