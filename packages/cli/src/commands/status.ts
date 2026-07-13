import { formatDuration } from "@reddit-cached/core";
import { flagStr } from "../args";
import { createContext } from "../context";
import { isHumanMode, printJson, printSection } from "../output";

const CURSOR_KEYS = {
  saved: "last_cursor_saved",
  upvoted: "last_cursor_upvoted",
  submitted: "last_cursor_submitted",
  comments: "last_cursor_commented",
} as const;

export async function statusCmd(
  flags: Record<string, string | boolean>,
  _positionals: string[],
): Promise<void> {
  const ctx = await createContext({ dbPath: flagStr(flags, "db") });

  try {
    const stats = ctx.storage.getStats();
    const tags = ctx.tags.listTags();
    const syncRuns = ctx.storage.getSyncRunSummaries();
    const resumeCursors = Object.fromEntries(
      Object.entries(CURSOR_KEYS)
        .map(([origin, key]) => [origin, ctx.storage.getSyncState(key)])
        .filter(
          (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0,
        ),
    );

    if (isHumanMode()) {
      printSection("Database", [
        ["Posts", stats.totalPosts],
        ["Comments", stats.totalComments],
        ["Total", stats.totalPosts + stats.totalComments],
        ["Orphaned", stats.orphanedCount],
        ...(stats.contextCount > 0
          ? [["Context items", stats.contextCount] as [string, unknown]]
          : []),
      ]);

      if (stats.lastSyncTime) {
        const ago = Date.now() - stats.lastSyncTime;
        printSection("Sync", [
          [
            "Last sync",
            `${new Date(stats.lastSyncTime).toLocaleString()} (${formatDuration(ago)} ago)`,
          ],
        ]);
      }

      if (syncRuns.length > 0) {
        printSection(
          "Origins",
          syncRuns.map((s): [string, unknown] => {
            const run = s.lastRun;
            if (!run) return [s.origin, "never synced"];
            const ago = formatDuration(Date.now() - run.finishedAt);
            const parts = [
              `${run.mode} ${run.status} ${ago} ago`,
              `${run.fetched} fetched`,
              ...(run.orphaned !== null ? [`${run.orphaned} orphaned`] : []),
              ...(run.saturated ? ["saturated: Reddit exposes only the newest ~1000 items"] : []),
            ];
            return [s.origin, parts.join(", ")];
          }),
        );
      }

      if (stats.subredditCounts.length > 0) {
        printSection(
          `Top Subreddits (${stats.subredditCounts.length} total)`,
          stats.subredditCounts.slice(0, 10).map((s) => [s.subreddit, s.count]),
        );
      }

      if (tags.length > 0) {
        printSection(
          "Tags",
          tags.map((t) => [t.name, `${t.count} post(s)`]),
        );
      }

      const resumeEntries: Array<[string, unknown]> = Object.entries(resumeCursors).map(
        ([origin, cursor]) => [origin, cursor],
      );
      if (resumeEntries.length > 0) {
        printSection("Resume Cursors", resumeEntries);
      }

      console.log();
    } else {
      printJson({
        ...stats,
        tags,
        ...(syncRuns.length > 0 ? { syncRuns } : {}),
        ...(Object.keys(resumeCursors).length > 0 ? { resumeCursors } : {}),
      });
    }
  } finally {
    ctx.close();
  }
}
