import { formatDuration } from "@reddit-saved/core";
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
        ...(Object.keys(resumeCursors).length > 0 ? { resumeCursors } : {}),
      });
    }
  } finally {
    ctx.close();
  }
}
