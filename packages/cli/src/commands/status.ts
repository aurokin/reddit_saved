import { SessionManager, formatDuration } from "@reddit-cached/core";
import { flagStr } from "../args";
import { type CliContext, createContext } from "../context";
import { isHumanMode, printJson, printSection } from "../output";

const CURSOR_KEYS = {
  saved: "last_cursor_saved",
  upvoted: "last_cursor_upvoted",
  submitted: "last_cursor_submitted",
  comments: "last_cursor_commented",
} as const;

/** Derived health warnings — the CLI mirror of the web app's HealthBanner.
 *  Everything is computed from existing state (job_runs + auth files). */
async function collectWarnings(ctx: CliContext): Promise<string[]> {
  const warnings: string[] = [];

  const lastJob = ctx.storage.getJobRunSummaries(1)[0];
  if (lastJob?.status === "errored") {
    const failedSteps = lastJob.steps.filter((s) => !s.ok).map((s) => s.step);
    const ago = formatDuration(Date.now() - (lastJob.finishedAt ?? lastJob.startedAt));
    const failedPart = failedSteps.length > 0 ? ` (failed steps: ${failedSteps.join(", ")})` : "";
    warnings.push(
      `Last scheduled run errored ${ago} ago${failedPart}. The archive is safe; syncs resume once the cause is fixed.`,
    );
  }

  const sessionManager = new SessionManager();
  let sessionAuthenticated = false;
  let sessionBlocked = false;
  try {
    await sessionManager.load();
    sessionAuthenticated = sessionManager.isAuthenticated();
    sessionBlocked = sessionManager.isBlocked();
  } catch {
    // Corrupt session.json — treated as not authenticated below.
  }

  if (sessionBlocked) {
    // While blocked, forwarded sessions are rejected — browsing reddit.com
    // with the extension cannot fix this, so don't suggest it.
    warnings.push(
      "Extension session is disconnected, so scheduled syncs are paused. " +
        "Reconnect from the web app's Settings page.",
    );
  } else if (!sessionAuthenticated) {
    let oauthSettings = null;
    try {
      oauthSettings = await ctx.tokenManager.load({ requireClientSecret: false });
    } catch {
      // Corrupt auth.json — treated as not authenticated.
    }
    if (!oauthSettings) {
      warnings.push(
        "Not authenticated — fetches and scheduled syncs will fail. " +
          "Connect the browser extension or run 'reddit-cached auth login'.",
      );
    }
  }

  return warnings;
}

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
    const warnings = await collectWarnings(ctx);

    if (isHumanMode()) {
      if (warnings.length > 0) {
        console.log("\nWarnings");
        console.log("--------");
        for (const warning of warnings) {
          console.log(`  ⚠ ${warning}`);
        }
      }

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
        ...(warnings.length > 0 ? { warnings } : {}),
      });
    }
  } finally {
    ctx.close();
  }
}
