import {
  type CheckpointData,
  type ContentOrigin,
  type FetchOptions,
  type OrphanDetectionResult,
  type SyncRunStatus,
  createOriginCheckpointManager,
  detectOrphans,
  formatDuration,
  paths,
} from "@reddit-cached/core";

const ORIGIN_MAP: Record<string, ContentOrigin> = {
  saved: "saved",
  upvoted: "upvoted",
  submitted: "submitted",
  comments: "commented",
};
import { flagBool, flagInt, flagStr } from "../args";
import { type CliContext, createContext } from "../context";
import {
  clearProgress,
  isHumanMode,
  printError,
  printInfo,
  printJson,
  printProgress,
  printSection,
  printWarning,
} from "../output";

export const VALID_TYPES = new Set(["saved", "upvoted", "submitted", "comments"]);

interface SyncStateStore {
  getSyncState(key: string): string | null;
  deleteSyncState(key: string): void;
}

function getCursorKey(origin: ContentOrigin): string {
  return `last_cursor_${origin}`;
}

function getStoredIncrementalCursor(storage: SyncStateStore, origin: ContentOrigin): string | null {
  return storage.getSyncState(getCursorKey(origin));
}

function clearStoredIncrementalCursor(storage: SyncStateStore, origin: ContentOrigin): void {
  storage.deleteSyncState(getCursorKey(origin));
}

function isCheckpointCompatible(
  checkpoint: CheckpointData,
  contentOrigin: ContentOrigin,
  isFull: boolean,
): boolean {
  return checkpoint.contentOrigin === contentOrigin && checkpoint.isFull === isFull;
}

export interface OriginFetchResult {
  type: string;
  status: SyncRunStatus;
  fetched: number;
  stored: number;
  hasMore: boolean;
  duration: string;
  cancelled?: true;
  errored?: true;
  orphaned?: number;
  saturated?: true;
  error?: string;
}

/** Run one origin's fetch end-to-end: checkpoint resume, page fetch, store,
 *  cursor advance, orphan detection, and sync_runs provenance recording.
 *  Exported for the jobs pipeline's fetch step. */
export async function runFetchForOrigin(
  ctx: CliContext,
  typeStr: string,
  opts: { isFull: boolean; limit?: number; dbPath?: string },
): Promise<OriginFetchResult> {
  const contentOrigin = ORIGIN_MAP[typeStr];
  const { isFull, limit, dbPath } = opts;

  const stateManager = await createOriginCheckpointManager(dbPath ?? paths.database, contentOrigin);
  const loadedCheckpoint = await stateManager.load();

  // Build fetch options
  const fetchOpts: FetchOptions = { limit };

  let checkpoint = loadedCheckpoint;

  if (checkpoint && !isCheckpointCompatible(checkpoint, contentOrigin, isFull)) {
    printWarning(
      `Ignoring checkpoint for ${checkpoint.isFull ? "full" : "incremental"} ${checkpoint.contentOrigin} fetch while running ${isFull ? "full" : "incremental"} ${contentOrigin}.`,
    );
    checkpoint = null;
  }

  // Resume from checkpoint if available
  if (checkpoint?.cursor) {
    printInfo(
      `Found checkpoint from ${new Date(checkpoint.startedAt).toLocaleString()}. ` +
        `Resuming from item ${checkpoint.totalFetched}.`,
    );
    fetchOpts.startCursor = checkpoint.cursor;
  } else if (!isFull) {
    const storedCursor = getStoredIncrementalCursor(ctx.storage, contentOrigin);
    if (storedCursor) {
      printInfo(`Resuming incremental ${typeStr} fetch from the last stored cursor.`);
      fetchOpts.startCursor = storedCursor;
    }
  }

  // Start performance monitoring
  ctx.monitor.startSession();
  const syncStartTime = Date.now();

  // Create checkpoint
  checkpoint ??= stateManager.createNew(undefined, { contentOrigin, isFull });
  checkpoint.contentOrigin = contentOrigin;
  checkpoint.isFull = isFull;
  checkpoint.cursor = fetchOpts.startCursor ?? checkpoint.cursor;
  checkpoint.phase = "fetching";
  await stateManager.save(checkpoint);

  // Pick the right fetch method — apiClient is guaranteed non-null by needsApi: true
  const api = ctx.apiClient as NonNullable<typeof ctx.apiClient>;
  const fetchMethod = {
    saved: api.fetchSaved.bind(api),
    upvoted: api.fetchUpvoted.bind(api),
    submitted: api.fetchUserPosts.bind(api),
    commented: api.fetchUserComments.bind(api),
  }[contentOrigin];

  const syncRunId = ctx.storage.startSyncRun(contentOrigin, isFull ? "full" : "incremental");

  let result: Awaited<ReturnType<typeof fetchMethod>>;
  try {
    result = await fetchMethod(fetchOpts);
  } catch (err) {
    ctx.monitor.endSession();
    ctx.storage.finishSyncRun(syncRunId, { status: "errored", fetched: 0 });
    throw err;
  }

  clearProgress();

  ctx.monitor.recordItemsFetched(result.items.length);

  if (result.items.length > 0) {
    checkpoint.phase = "storing";
    await stateManager.save(checkpoint);
    printProgress(`Storing ${result.items.length} items...`);
    ctx.storage.upsertPosts(result.items, contentOrigin);
    for (let i = 0; i < result.items.length; i++) {
      ctx.monitor.recordItemProcessed("stored");
    }
    clearProgress();
  }

  // Advance the resume cursor only after the fetched page is stored successfully.
  checkpoint.phase = "fetching";
  checkpoint.cursor = result.cursor;
  checkpoint.totalFetched += result.items.length;
  await stateManager.save(checkpoint);

  if (result.wasErrored || result.wasCancelled) {
    if (!isFull && result.cursor) {
      ctx.storage.setSyncState(getCursorKey(contentOrigin), result.cursor);
    }

    ctx.monitor.endSession();
    const summary = ctx.monitor.getSummary();
    const status: SyncRunStatus = result.wasCancelled ? "cancelled" : "errored";
    ctx.storage.finishSyncRun(syncRunId, { status, fetched: result.items.length });

    printWarning(
      `Fetch ${status} before completion. Resume state was preserved; sync timestamps were not updated.`,
    );

    return {
      type: typeStr,
      status,
      fetched: result.items.length,
      stored: result.items.length,
      hasMore: result.hasMore,
      duration: formatDuration(summary.durationMs),
      ...(result.wasCancelled ? { cancelled: true as const } : {}),
      ...(result.wasErrored ? { errored: true as const } : {}),
    };
  }

  // Update sync state
  ctx.storage.setSyncState("last_sync_time", String(syncStartTime));
  if (isFull) {
    ctx.storage.setSyncState("last_full_sync_time", String(syncStartTime));
  }
  if (!isFull && result.hasMore && result.cursor) {
    ctx.storage.setSyncState(getCursorKey(contentOrigin), result.cursor);
  } else {
    clearStoredIncrementalCursor(ctx.storage, contentOrigin);
  }

  // Orphan detection on full sync
  let orphanResult: OrphanDetectionResult | undefined;
  if (isFull) {
    checkpoint.phase = "cleanup";
    await stateManager.save(checkpoint);
    // Threshold must be the checkpoint's original start, not this run's:
    // a resumed full sync only refetches items after the saved cursor, so
    // items stored by the interrupted earlier run carry an older
    // last_seen_at and would be falsely orphaned by the current clock.
    orphanResult = detectOrphans(ctx.storage, checkpoint.startedAt, [contentOrigin]);
    if (orphanResult.reason) {
      printWarning(orphanResult.reason);
    }
  }

  // Clear checkpoint on success
  await stateManager.clear();

  // End monitoring
  ctx.monitor.endSession();
  const summary = ctx.monitor.getSummary();

  // An incremental page with more remaining is real progress but not full
  // coverage — record it as partial so provenance doesn't overclaim.
  const status: SyncRunStatus = !isFull && result.hasMore ? "partial" : "complete";
  const saturated = orphanResult?.skippedOrigins.includes(contentOrigin) ?? false;
  ctx.storage.finishSyncRun(syncRunId, {
    status,
    fetched: result.items.length,
    orphaned: orphanResult?.orphanedCount,
    saturated,
  });

  return {
    type: typeStr,
    status,
    fetched: result.items.length,
    stored: result.items.length,
    hasMore: result.hasMore,
    duration: formatDuration(summary.durationMs),
    ...(orphanResult ? { orphaned: orphanResult.orphanedCount } : {}),
    ...(saturated ? { saturated: true as const } : {}),
  };
}

function printHumanResult(result: OriginFetchResult): void {
  const incomplete = result.status === "cancelled" || result.status === "errored";
  printSection(incomplete ? "Fetch Incomplete" : "Fetch Complete", [
    ["Type", result.type],
    ["Fetched", result.fetched],
    ["Stored", result.stored],
    ["Duration", result.duration],
    ...(incomplete
      ? ([
          ["Status", result.status],
          ["Resume preserved", "yes"],
        ] as Array<[string, unknown]>)
      : []),
    ...(result.error ? [["Error", result.error] as [string, unknown]] : []),
    ...(!incomplete && result.hasMore
      ? [["More available", "yes (run again to continue)"] as [string, unknown]]
      : []),
    ...(result.orphaned !== undefined ? [["Orphaned", result.orphaned] as [string, unknown]] : []),
    ...(result.saturated
      ? [["Saturated", "yes (Reddit caps listings at ~1000)"] as [string, unknown]]
      : []),
  ]);
  console.log();
}

export async function fetchCmd(
  flags: Record<string, string | boolean>,
  _positionals: string[],
): Promise<void> {
  const fetchAll = flagBool(flags, "all");
  const typeStr = flagStr(flags, "type") ?? "saved";
  if (fetchAll && flagStr(flags, "type")) {
    printError("--all and --type are mutually exclusive.");
    process.exit(1);
  }
  if (!VALID_TYPES.has(typeStr)) {
    printError(`Invalid --type: "${typeStr}". Must be one of: ${[...VALID_TYPES].join(", ")}`);
    process.exit(1);
  }

  const isFull = flagBool(flags, "full");
  const limit = flagInt(flags, "limit");
  const dbPath = flagStr(flags, "db");

  const ctx = await createContext({ needsApi: true, dbPath });

  try {
    if (!fetchAll) {
      const result = await runFetchForOrigin(ctx, typeStr, { isFull, limit, dbPath });
      if (isHumanMode()) {
        printHumanResult(result);
      } else {
        const { status: _status, ...output } = result;
        printJson(output);
      }
      return;
    }

    // --all: run every origin sequentially; one origin failing must not
    // abort the rest (e.g. suspended account still has saved/upvoted).
    const results: OriginFetchResult[] = [];
    for (const originType of VALID_TYPES) {
      printInfo(`Fetching ${originType}...`);
      try {
        results.push(await runFetchForOrigin(ctx, originType, { isFull, limit, dbPath }));
      } catch (err) {
        clearProgress();
        const message = err instanceof Error ? err.message : String(err);
        printWarning(`Fetch of ${originType} failed: ${message}`);
        results.push({
          type: originType,
          status: "errored",
          fetched: 0,
          stored: 0,
          hasMore: false,
          duration: "0ms",
          errored: true,
          error: message,
        });
      }
    }

    if (isHumanMode()) {
      for (const result of results) {
        printHumanResult(result);
      }
    } else {
      printJson({ all: true, origins: results });
    }

    if (results.some((r) => r.status === "errored")) {
      process.exitCode = 1;
    }
  } finally {
    ctx.close();
  }
}
