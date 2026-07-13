import { INBOX_SYNC_DEFAULT_LIMIT, type SyncRunStatus, syncInbox } from "@reddit-cached/core";
import { flagInt, flagStr } from "../args";
import { createContext } from "../context";
import { clearProgress, isHumanMode, printJson, printProgress, printSection } from "../output";

/** `fetch inbox` — sync comment replies, mentions, and private messages into
 *  the inbox_items table (t1 items are also mirrored into posts as context
 *  rows). Stops early once a page contains nothing new or changed. */
export async function fetchInboxCmd(
  flags: Record<string, string | boolean>,
  _positionals: string[],
): Promise<void> {
  const limit = flagInt(flags, "limit") ?? INBOX_SYNC_DEFAULT_LIMIT;

  const ctx = await createContext({ needsApi: true, dbPath: flagStr(flags, "db") });

  try {
    const api = ctx.apiClient as NonNullable<typeof ctx.apiClient>;
    const syncRunId = ctx.storage.startSyncRun("inbox", "incremental");

    let result: Awaited<ReturnType<typeof syncInbox>>;
    try {
      result = await syncInbox(ctx.storage, api, {
        limit,
        onPage: (page, count) => {
          printProgress(`Fetching inbox page ${page} (${count} items)...`);
        },
      });
    } catch (err) {
      ctx.storage.finishSyncRun(syncRunId, { status: "errored", fetched: 0 });
      throw err;
    }

    clearProgress();

    const status: SyncRunStatus = result.wasCancelled ? "cancelled" : "complete";
    ctx.storage.finishSyncRun(syncRunId, { status, fetched: result.fetched });

    if (isHumanMode()) {
      printSection("Inbox Sync", [
        ["Fetched", result.fetched],
        ["New items", result.inserted],
        ["Updated", result.updated],
        ["Context rows stored", result.contextItemsStored],
        ["Pages", result.pages],
        ["Stopped early", result.stoppedEarly ? "yes (caught up)" : "no"],
      ]);
      console.log();
    } else {
      printJson(result);
    }
  } finally {
    ctx.close();
  }
}
