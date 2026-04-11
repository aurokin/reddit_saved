/**
 * Output formatters for the CLI.
 *
 * JSON mode (default): structured data to stdout, messages to stderr.
 * Human mode (--human/-H): tables and readable text to stdout, progress to stderr.
 */

let _isHuman = false;
let _isVerbose = false;
let _isQuiet = false;

export function setOutputMode(human: boolean, verbose: boolean, quiet: boolean): void {
  _isHuman = human;
  _isVerbose = verbose;
  _isQuiet = quiet;
}

export function isHumanMode(): boolean {
  return _isHuman;
}

// ---------------------------------------------------------------------------
// Stdout
// ---------------------------------------------------------------------------

/** Print structured data as JSON to stdout */
export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export interface ColumnDef {
  key: string;
  header: string;
  width?: number;
  align?: "left" | "right";
}

/** Print a table to stdout in human mode */
// biome-ignore lint/suspicious/noExplicitAny: rows can be any object shape
export function printTable(rows: any[], columns: ColumnDef[]): void {
  if (rows.length === 0) {
    console.log("(no results)");
    return;
  }

  // Calculate column widths
  const widths = columns.map((col) => {
    if (col.width) return col.width;
    let max = col.header.length;
    for (const row of rows) {
      const val = String(row[col.key] ?? "");
      max = Math.max(max, val.length);
    }
    return Math.min(max, 60); // cap individual columns
  });

  // Header
  const headerLine = columns.map((col, i) => pad(col.header, widths[i], col.align)).join("  ");
  console.log(headerLine);
  console.log(columns.map((_, i) => "-".repeat(widths[i])).join("  "));

  // Rows
  for (const row of rows) {
    const line = columns
      .map((col, i) => {
        const val = String(row[col.key] ?? "");
        return pad(truncate(val, widths[i]), widths[i], col.align);
      })
      .join("  ");
    console.log(line);
  }
}

/** Print a single key-value section in human mode */
export function printSection(title: string, entries: [string, unknown][]): void {
  if (entries.length === 0) return;
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
  const keyWidth = Math.max(...entries.map(([k]) => k.length));
  for (const [key, value] of entries) {
    console.log(`  ${key.padEnd(keyWidth)}  ${value}`);
  }
}

// ---------------------------------------------------------------------------
// Stderr
// ---------------------------------------------------------------------------

/** Print an error to stderr. In JSON mode, outputs structured error. */
export function printError(message: string, code?: string): void {
  if (_isHuman) {
    console.error(`Error: ${message}`);
  } else {
    console.error(JSON.stringify({ error: message, ...(code ? { code } : {}) }));
  }
}

/** Print a warning to stderr (suppressed in quiet mode) */
export function printWarning(message: string): void {
  if (_isQuiet) return;
  if (_isHuman) {
    console.error(`Warning: ${message}`);
  } else {
    console.error(JSON.stringify({ warning: message }));
  }
}

/** Print a progress message to stderr (suppressed in quiet mode) */
export function printProgress(message: string): void {
  if (_isQuiet) return;
  if (process.stderr.isTTY) {
    process.stderr.write(`\r\x1b[K${message}`);
  } else {
    console.error(message);
  }
}

/** Clear progress line (TTY only) */
export function clearProgress(): void {
  if (process.stderr.isTTY) {
    process.stderr.write("\r\x1b[K");
  }
}

/** Print info to stderr (only in verbose mode) */
export function printVerbose(message: string): void {
  if (!_isVerbose) return;
  console.error(message);
}

/** Print a plain message to stderr (suppressed in quiet mode) */
export function printInfo(message: string): void {
  if (_isQuiet) return;
  console.error(message);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pad(str: string, width: number, align?: "left" | "right"): string {
  if (align === "right") return str.padStart(width);
  return str.padEnd(width);
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen - 1)}…`;
}

// ---------------------------------------------------------------------------
// Post formatting helpers (shared by search, list, etc.)
// ---------------------------------------------------------------------------

export interface PostSummary {
  id: string;
  kind: string;
  title: string;
  subreddit: string;
  author: string;
  score: number;
  permalink: string;
  created_utc: number;
  tags?: string;
  snippet?: string;
}

/** Format a PostRow into a summary suitable for JSON output */
export function formatPostForOutput(row: {
  id: string;
  kind: string;
  title?: string | null;
  subreddit: string;
  author: string;
  score: number;
  permalink: string;
  created_utc: number;
  link_title?: string | null;
  snippet?: string;
  rank?: number;
  tags?: string | null;
}): PostSummary {
  return {
    id: row.id,
    kind: row.kind === "t1" ? "comment" : "post",
    title: row.title || row.link_title || "(untitled)",
    subreddit: row.subreddit,
    author: row.author,
    score: row.score,
    permalink: `https://reddit.com${row.permalink}`,
    created_utc: row.created_utc,
    ...(row.tags ? { tags: row.tags } : {}),
    ...(row.snippet ? { snippet: row.snippet } : {}),
  };
}

/** Column definitions for post tables in human mode */
export const POST_COLUMNS: ColumnDef[] = [
  { key: "id", header: "ID", width: 8 },
  { key: "kind", header: "Type", width: 7 },
  { key: "title", header: "Title", width: 40 },
  { key: "subreddit", header: "Subreddit", width: 20 },
  { key: "score", header: "Score", width: 6, align: "right" },
];

export const POST_COLUMNS_WITH_SNIPPET: ColumnDef[] = [
  { key: "id", header: "ID", width: 8 },
  { key: "title", header: "Title", width: 30 },
  { key: "subreddit", header: "Subreddit", width: 15 },
  { key: "score", header: "Score", width: 6, align: "right" },
  { key: "snippet", header: "Match", width: 35 },
];
