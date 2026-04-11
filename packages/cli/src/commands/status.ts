import { formatDuration } from "@reddit-saved/core";
import { flagStr } from "../args";
import { createContext } from "../context";
import { isHumanMode, printJson, printSection } from "../output";

export async function statusCmd(
  flags: Record<string, string | boolean>,
  _positionals: string[],
): Promise<void> {
  const ctx = await createContext({ dbPath: flagStr(flags, "db") });

  try {
    const stats = ctx.storage.getStats();
    const tags = ctx.tags.listTags();

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

      console.log();
    } else {
      printJson({ ...stats, tags });
    }
  } finally {
    ctx.close();
  }
}
