import { CONTENT_ORIGINS, REDDIT_BASE_URL } from "../constants";
import type { TopLink } from "../links/link-index";
import type { SqliteAdapter } from "../storage/sqlite-adapter";
import type {
  ContentOrigin,
  InboxItemType,
  JobRunSummary,
  PostRow,
  SyncRunSummary,
} from "../types";

/**
 * Deterministic "what's new" digest — the local answer to "what happened on
 * my Reddit lately". No AI, no network; the same database state and `now`
 * always render the same digest (agents do the reasoning on top).
 *
 * The window is measured on fetched_at ("new to the archive"), not
 * created_utc — save-time isn't otherwise knowable, and a digest is about
 * what the archive learned since you last looked.
 */

export interface TodayOptions {
  /** Window size in ms (default 24h) */
  windowMs?: number;
  /** Injectable clock for deterministic tests */
  now?: number;
  /** Max items listed per section (default 5) */
  limitPerSection?: number;
}

export interface TodayDigestItem {
  id: string;
  kind: string;
  title: string;
  subreddit: string;
  permalink: string;
  score: number;
}

export interface TodayDigest {
  /** epoch ms — the injected/derived `now` */
  generatedAt: number;
  /** epoch ms */
  windowStart: number;
  windowMs: number;
  syncHealth: Array<{
    origin: SyncRunSummary["origin"];
    lastRun: SyncRunSummary["lastRun"];
    lastCompleteFullAt: number | null;
    /** finished longer than 2× the window ago (or never) */
    stale: boolean;
  }>;
  newByOrigin: Array<{ origin: ContentOrigin; count: number; top: TodayDigestItem[] }>;
  inbox: {
    /** Inbox items created inside the window (created_utc-based) */
    newCount: number;
    unreadCount: number;
    items: Array<{
      type: InboxItemType;
      author: string | null;
      subject: string | null;
      linkTitle: string | null;
      subreddit: string | null;
      isNew: boolean;
      createdUtc: number;
    }>;
  };
  topLinks: TopLink[];
  context: { captured: number; backlog: number };
  jobs: { lastRun: JobRunSummary | null };
}

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

export function buildTodayDigest(storage: SqliteAdapter, options: TodayOptions = {}): TodayDigest {
  const now = options.now ?? Date.now();
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const limitPerSection = options.limitPerSection ?? 5;
  const windowStart = now - windowMs;
  const windowStartSeconds = Math.floor(windowStart / 1000);

  const summaries = storage.getSyncRunSummaries();
  const syncHealth = summaries.map((s) => ({
    origin: s.origin,
    lastRun: s.lastRun,
    lastCompleteFullAt: s.lastCompleteFullAt,
    stale: s.lastRun === null || now - s.lastRun.finishedAt > 2 * windowMs,
  }));

  const newByOrigin = CONTENT_ORIGINS.map((origin) => {
    const count = storage.countPosts({ contentOrigin: origin, fetchedAfter: windowStart });
    const top =
      count > 0
        ? storage
            .listPosts({
              contentOrigin: origin,
              fetchedAfter: windowStart,
              sort: "score",
              sortDirection: "desc",
              limit: limitPerSection,
            })
            .map(toDigestItem)
        : [];
    return { origin, count, top };
  });

  // Inbox windows on created_utc — messages arrive with their own timestamps
  // and "new since yesterday" should mean sent-then, not synced-then.
  const inboxItems = storage.listInboxItems({
    createdAfter: windowStartSeconds,
    limit: limitPerSection,
  });
  const inbox = {
    newCount: storage.countInboxItems({ createdAfter: windowStartSeconds }),
    unreadCount: storage.countUnreadInbox(),
    items: inboxItems.map((item) => ({
      type: item.type,
      author: item.author,
      subject: item.subject,
      linkTitle: item.link_title,
      subreddit: item.subreddit,
      isNew: item.is_new === 1,
      createdUtc: item.created_utc,
    })),
  };

  // topLinks filters on created_utc (seconds) — post age, not archive age.
  // Documented mismatch: links have no fetched_at of their own.
  const topLinks = storage.topLinks({
    since: windowStartSeconds,
    excludeReddit: true,
    limit: limitPerSection,
  });

  const stats = storage.getStats();
  const context = {
    captured: stats.contextCount,
    backlog: storage.getContextCandidates(10_000).length,
  };

  return {
    generatedAt: now,
    windowStart,
    windowMs,
    syncHealth,
    newByOrigin,
    inbox,
    topLinks,
    context,
    jobs: { lastRun: storage.getJobRunSummaries(1)[0] ?? null },
  };
}

function toDigestItem(row: PostRow): TodayDigestItem {
  const title = row.title ?? row.body ?? row.link_title ?? row.id;
  return {
    id: row.id,
    kind: row.kind,
    title: title.replace(/\s+/g, " ").trim().slice(0, 120),
    subreddit: row.subreddit,
    permalink: row.permalink.startsWith("http")
      ? row.permalink
      : `${REDDIT_BASE_URL}${row.permalink}`,
    score: row.score,
  };
}

const ORIGIN_LABELS: Record<ContentOrigin, string> = {
  saved: "Saved",
  upvoted: "Upvoted",
  submitted: "Posted",
  commented: "Commented",
};

const INBOX_TYPE_LABELS: Record<InboxItemType, string> = {
  comment_reply: "reply",
  post_reply: "reply",
  mention: "mention",
  message: "message",
};

export function renderTodayDigest(digest: TodayDigest): string {
  const hours = Math.round(digest.windowMs / 3_600_000);
  const lines: string[] = [];
  lines.push(`# Today: last ${hours}h`, "");

  // Activity
  const active = digest.newByOrigin.filter((o) => o.count > 0);
  lines.push("## Activity", "");
  if (active.length === 0) {
    lines.push("Nothing new reached the archive in this window.", "");
  } else {
    for (const origin of active) {
      lines.push(`### ${ORIGIN_LABELS[origin.origin]} (${origin.count})`, "");
      for (const item of origin.top) {
        lines.push(`- [${item.title}](${item.permalink}) — r/${item.subreddit} · ${item.score}`);
      }
      lines.push("");
    }
  }

  // Inbox
  lines.push("## Inbox", "");
  if (digest.inbox.newCount === 0 && digest.inbox.unreadCount === 0) {
    lines.push("No new replies, mentions, or messages.", "");
  } else {
    lines.push(
      `${digest.inbox.newCount} new in window · ${digest.inbox.unreadCount} unread total`,
      "",
    );
    for (const item of digest.inbox.items) {
      const label = INBOX_TYPE_LABELS[item.type];
      const about = item.subject ?? item.linkTitle ?? "";
      const where = item.subreddit ? ` in r/${item.subreddit}` : "";
      lines.push(
        `- ${item.isNew ? "● " : ""}${label} from u/${item.author ?? "[unknown]"}${where}${about ? ` — ${about}` : ""}`,
      );
    }
    lines.push("");
  }

  // Links
  if (digest.topLinks.length > 0) {
    lines.push("## New links", "");
    for (const link of digest.topLinks) {
      lines.push(`- ${link.canonical_url} (${link.postCount} post(s))`);
    }
    lines.push("");
  }

  // Sync health
  lines.push("## Sync health", "");
  if (digest.syncHealth.length === 0) {
    lines.push("No sync runs recorded yet — run `reddit-cached fetch --all`.", "");
  } else {
    for (const origin of digest.syncHealth) {
      const run = origin.lastRun;
      if (!run) continue;
      const ago = formatAgo(digest.generatedAt - run.finishedAt);
      const flags = [
        run.status !== "complete" ? run.status : null,
        run.saturated ? "saturated" : null,
        origin.stale ? "stale" : null,
      ]
        .filter(Boolean)
        .join(", ");
      lines.push(`- ${origin.origin}: ${run.fetched} fetched ${ago}${flags ? ` (${flags})` : ""}`);
    }
    lines.push("");
  }

  // Context coverage
  lines.push(
    `Context: ${digest.context.captured} rows captured, ${digest.context.backlog} saved item(s) pending.`,
  );

  // Last pipeline run
  const job = digest.jobs.lastRun;
  if (job) {
    const ago =
      job.finishedAt !== null ? formatAgo(digest.generatedAt - job.finishedAt) : "running";
    const failed = job.steps.filter((s) => !s.ok).map((s) => s.step);
    lines.push(
      `Last pipeline run: ${job.status} ${ago} (${job.trigger})${failed.length > 0 ? ` — failed: ${failed.join(", ")}` : ""}`,
    );
  }
  lines.push("");

  return lines.join("\n");
}

function formatAgo(deltaMs: number): string {
  const minutes = Math.max(0, Math.floor(deltaMs / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hoursAgo = Math.floor(minutes / 60);
  if (hoursAgo < 48) return `${hoursAgo}h ago`;
  return `${Math.floor(hoursAgo / 24)}d ago`;
}
