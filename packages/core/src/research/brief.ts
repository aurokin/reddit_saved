import {
  REDDIT_BASE_URL,
  SEARCH_SNIPPET_HIGHLIGHT_END,
  SEARCH_SNIPPET_HIGHLIGHT_START,
} from "../constants";
import { isRedditHost } from "../links/url-extract";
import type { SqliteAdapter } from "../storage/sqlite-adapter";
import type { PostRow, SearchResult } from "../types";

/**
 * Deterministic research briefs: full-text search seeds → stored thread
 * assembly (including 'context' rows) → markdown with citations.
 *
 * No AI, no network, no timestamps — the same database state and query
 * always render the same brief, so output is snapshot-testable.
 */

export interface ResearchOptions {
  /** Max seed matches (default 10) */
  limit?: number;
  /** created_utc lower bound, epoch seconds */
  since?: number;
  /** created_utc upper bound, epoch seconds */
  until?: number;
  /** Include low-quality rows (deleted/bots/short low-score comments) */
  includeLowQuality?: boolean;
}

export interface ResearchSeed {
  post: SearchResult;
  /** Full stored thread around the seed (ancestors + descendants + context) */
  thread: PostRow[];
}

export interface ResearchBrief {
  query: string;
  seeds: ResearchSeed[];
  subreddits: Array<{ subreddit: string; count: number }>;
  links: Array<{ canonical_url: string; host: string; count: number }>;
}

export function buildResearchBrief(
  storage: SqliteAdapter,
  query: string,
  options: ResearchOptions = {},
): ResearchBrief {
  const matches = storage.searchPosts(query, {
    limit: options.limit ?? 10,
    hideLowQuality: !options.includeLowQuality,
    createdAfter: options.since,
    createdBefore: options.until,
  });

  // Assemble threads; a match already covered by an earlier seed's thread is
  // folded into that seed instead of repeating as its own section.
  const seenIds = new Set<string>();
  const seeds: ResearchSeed[] = [];
  for (const match of matches) {
    if (seenIds.has(match.id)) continue;
    const thread = storage.getThread(match.name);
    for (const row of thread) seenIds.add(row.id);
    seenIds.add(match.id);
    seeds.push({ post: match, thread });
  }

  // Subreddit distribution over the seed matches
  const subredditCounts = new Map<string, number>();
  for (const seed of seeds) {
    subredditCounts.set(seed.post.subreddit, (subredditCounts.get(seed.post.subreddit) ?? 0) + 1);
  }
  const subreddits = [...subredditCounts.entries()]
    .map(([subreddit, count]) => ({ subreddit, count }))
    .sort((a, b) => b.count - a.count || (a.subreddit < b.subreddit ? -1 : 1));

  // Outbound links referenced anywhere in the assembled material
  const ids = [...seenIds];
  const links: Array<{ canonical_url: string; host: string; count: number }> = [];
  if (ids.length > 0) {
    const CHUNK = 500;
    const counts = new Map<string, { host: string; count: number }>();
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => "?").join(",");
      const rows = storage
        .getDb()
        .query(
          `SELECT canonical_url, host, COUNT(DISTINCT post_id) AS count
           FROM link_occurrences
           WHERE post_id IN (${placeholders})
           GROUP BY canonical_url`,
        )
        .all(...chunk) as Array<{ canonical_url: string; host: string; count: number }>;
      for (const row of rows) {
        const existing = counts.get(row.canonical_url);
        if (existing) existing.count += row.count;
        else counts.set(row.canonical_url, { host: row.host, count: row.count });
      }
    }
    for (const [canonical_url, { host, count }] of counts) {
      if (!isRedditHost(host)) links.push({ canonical_url, host, count });
    }
    links.sort((a, b) => b.count - a.count || (a.canonical_url < b.canonical_url ? -1 : 1));
    links.splice(15);
  }

  return { query, seeds, subreddits, links };
}

const QUOTE_MAX = 280;

function isoDate(createdUtcSeconds: number): string {
  return new Date(createdUtcSeconds * 1000).toISOString().slice(0, 10);
}

function quote(row: PostRow): string {
  const text = (row.body ?? row.selftext ?? row.title ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= QUOTE_MAX) return text;
  return `${text.slice(0, QUOTE_MAX - 1).trimEnd()}…`;
}

function permalinkUrl(row: PostRow): string {
  return row.permalink.startsWith("http") ? row.permalink : `${REDDIT_BASE_URL}${row.permalink}`;
}

function cleanSnippet(snippet: string): string {
  return snippet
    .replaceAll(SEARCH_SNIPPET_HIGHLIGHT_START, "**")
    .replaceAll(SEARCH_SNIPPET_HIGHLIGHT_END, "**")
    .replace(/\s+/g, " ")
    .trim();
}

/** Depth-first thread bullets, indented two spaces per level. */
function renderThread(thread: PostRow[], seedId: string): string[] {
  const byParent = new Map<string, PostRow[]>();
  const names = new Set(thread.map((r) => r.name));
  const roots: PostRow[] = [];
  for (const row of thread) {
    if (row.parent_id && names.has(row.parent_id)) {
      let children = byParent.get(row.parent_id);
      if (!children) {
        children = [];
        byParent.set(row.parent_id, children);
      }
      children.push(row);
    } else {
      roots.push(row);
    }
  }

  const lines: string[] = [];
  const walk = (row: PostRow, depth: number): void => {
    const indent = "  ".repeat(depth);
    const marker = row.id === seedId ? " ⭐" : "";
    const text = quote(row);
    lines.push(
      `${indent}- [u/${row.author}](${permalinkUrl(row)}) (${row.score})${marker}${text ? `: ${text}` : ""}`,
    );
    for (const child of byParent.get(row.name) ?? []) {
      walk(child, depth + 1);
    }
  };
  for (const root of roots) walk(root, 0);
  return lines;
}

export function renderResearchBrief(brief: ResearchBrief): string {
  const lines: string[] = [];
  lines.push(`# Research: ${brief.query}`, "");

  const threadItems = brief.seeds.reduce((sum, s) => sum + s.thread.length, 0);
  lines.push(
    `${brief.seeds.length} match(es) across ${brief.subreddits.length} subreddit(s); ${threadItems} thread item(s) considered.`,
    "",
  );

  brief.seeds.forEach((seed, index) => {
    const post = seed.post;
    const heading = post.title ?? (quote(post) || `Comment ${post.id}`);
    lines.push(`## ${index + 1}. ${heading} — r/${post.subreddit}`, "");
    lines.push(
      `[u/${post.author}](${permalinkUrl(post)}) · score ${post.score} · ${isoDate(post.created_utc)}`,
    );
    const snippet = cleanSnippet(post.snippet ?? "");
    if (snippet) {
      lines.push("", `> ${snippet}`);
    }
    if (seed.thread.length > 1) {
      lines.push("", "Thread:", "", ...renderThread(seed.thread, post.id));
    }
    lines.push("");
  });

  if (brief.links.length > 0) {
    lines.push("## Links", "");
    for (const link of brief.links) {
      lines.push(`- ${link.canonical_url} (${link.count})`);
    }
    lines.push("");
  }

  if (brief.subreddits.length > 0) {
    lines.push("## Subreddits", "");
    for (const sub of brief.subreddits) {
      lines.push(`- r/${sub.subreddit}: ${sub.count}`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
