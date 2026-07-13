import {
  CONTEXT_SYNC_DEFAULT_LIMIT,
  CONTEXT_SYNC_DEFAULT_TOP_COMMENTS,
  syncContext,
} from "@reddit-saved/core";
import { flagInt, flagStr } from "../args";
import { createContext } from "../context";
import {
  clearProgress,
  isHumanMode,
  printJson,
  printProgress,
  printSection,
  printVerbose,
  printWarning,
} from "../output";

/** `fetch context` — capture thread context around saved items.
 *  Saved comments get their ancestor chain; saved posts get top comments.
 *  Per-item resumable via posts.context_fetched_at; run repeatedly to work
 *  through the backlog. */
export async function fetchContextCmd(
  flags: Record<string, string | boolean>,
  _positionals: string[],
): Promise<void> {
  const limit = flagInt(flags, "limit") ?? CONTEXT_SYNC_DEFAULT_LIMIT;
  const topComments = flagInt(flags, "top-comments") ?? CONTEXT_SYNC_DEFAULT_TOP_COMMENTS;
  const refreshDays = flagInt(flags, "refresh");

  const ctx = await createContext({ needsApi: true, dbPath: flagStr(flags, "db") });

  try {
    const api = ctx.apiClient as NonNullable<typeof ctx.apiClient>;
    const result = await syncContext(ctx.storage, api, {
      limit,
      topComments,
      refreshDays,
      onItem: (processed, total, item) => {
        printProgress(
          `Capturing context ${processed}/${total} (${item.kind === "t1" ? "comment" : "post"} in r/${item.subreddit})...`,
        );
      },
      onError: (item, error) => {
        clearProgress();
        printVerbose(
          `Context capture failed for ${item.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      },
    });

    clearProgress();

    if (result.failed > 0) {
      printWarning(
        `${result.failed} item(s) failed to capture; they stay unstamped and retry next run.`,
      );
    }

    if (isHumanMode()) {
      printSection("Context Capture", [
        ["Processed", result.processed],
        ["Captured", result.captured],
        ["Context items stored", result.contextItemsStored],
        ["Failed", result.failed],
        ["Remaining", result.remaining],
        ...(result.remaining > 0
          ? [["Next step", "run 'fetch context' again to continue"] as [string, unknown]]
          : []),
      ]);
      console.log();
    } else {
      printJson(result);
    }
  } finally {
    ctx.close();
  }
}
