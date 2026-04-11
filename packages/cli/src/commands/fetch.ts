import { dirname, join } from "node:path";
import {
  type ContentOrigin,
  type FetchOptions,
  type OrphanDetectionResult,
  SyncStateManager,
  detectOrphans,
  formatDuration,
} from "@reddit-saved/core";

const ORIGIN_MAP: Record<string, ContentOrigin> = {
  saved: "saved",
  upvoted: "upvoted",
  submitted: "submitted",
  comments: "commented",
};
import { flagBool, flagInt, flagStr } from "../args";
import { createContext } from "../context";
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

const VALID_TYPES = new Set(["saved", "upvoted", "submitted", "comments"]);

export async function fetchCmd(
  flags: Record<string, string | boolean>,
  _positionals: string[],
): Promise<void> {
  const typeStr = flagStr(flags, "type") ?? "saved";
  if (!VALID_TYPES.has(typeStr)) {
    printError(`Invalid --type: "${typeStr}". Must be one of: ${[...VALID_TYPES].join(", ")}`);
    process.exit(1);
  }
  const contentOrigin = ORIGIN_MAP[typeStr];

  const isFull = flagBool(flags, "full");
  const limit = flagInt(flags, "limit");
  const dbPath = flagStr(flags, "db");

  const ctx = await createContext({ needsApi: true, dbPath });

  try {
    // Co-locate checkpoint with the database when --db is used
    const checkpointPath = dbPath
      ? join(dirname(dbPath), ".reddit-import-checkpoint.json")
      : undefined;
    const stateManager = new SyncStateManager(checkpointPath);
    const existingCheckpoint = await stateManager.load();

    // Build fetch options
    const fetchOpts: FetchOptions = { limit };

    // Resume from checkpoint if available
    if (existingCheckpoint?.cursor) {
      printInfo(
        `Found checkpoint from ${new Date(existingCheckpoint.startedAt).toLocaleString()}. ` +
          `Resuming from item ${existingCheckpoint.totalFetched}.`,
      );
      fetchOpts.startCursor = existingCheckpoint.cursor;
    }

    // Start performance monitoring
    ctx.monitor.startSession();
    const syncStartTime = Date.now();

    // Create checkpoint
    const checkpoint = existingCheckpoint ?? stateManager.createNew();
    checkpoint.phase = "fetching";

    // Pick the right fetch method — apiClient is guaranteed non-null by needsApi: true
    const api = ctx.apiClient as NonNullable<typeof ctx.apiClient>;
    const fetchMethod = {
      saved: api.fetchSaved.bind(api),
      upvoted: api.fetchUpvoted.bind(api),
      submitted: api.fetchUserPosts.bind(api),
      commented: api.fetchUserComments.bind(api),
    }[contentOrigin];

    // Fetch
    const result = await fetchMethod(fetchOpts);

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

    // Update sync state
    ctx.storage.setSyncState("last_sync_time", String(syncStartTime));
    if (isFull) {
      ctx.storage.setSyncState("last_full_sync_time", String(syncStartTime));
    }
    if (result.cursor) {
      ctx.storage.setSyncState("last_cursor", result.cursor);
    }

    // Orphan detection on full sync
    let orphanResult: OrphanDetectionResult | undefined;
    if (isFull) {
      checkpoint.phase = "cleanup";
      await stateManager.save(checkpoint);
      orphanResult = detectOrphans(ctx.storage, syncStartTime, [contentOrigin]);
      if (orphanResult.reason) {
        printWarning(orphanResult.reason);
      }
    }

    // Clear checkpoint on success
    await stateManager.clear();

    // End monitoring
    ctx.monitor.endSession();
    const summary = ctx.monitor.getSummary();

    // Output
    const output = {
      type: typeStr,
      fetched: result.items.length,
      stored: result.items.length,
      hasMore: result.hasMore,
      duration: formatDuration(summary.durationMs),
      ...(result.wasCancelled ? { cancelled: true } : {}),
      ...(orphanResult ? { orphaned: orphanResult.orphanedCount } : {}),
    };

    if (isHumanMode()) {
      printSection("Fetch Complete", [
        ["Type", typeStr],
        ["Fetched", result.items.length],
        ["Stored", result.items.length],
        ["Duration", formatDuration(summary.durationMs)],
        ...(result.hasMore
          ? [["More available", "yes (run again to continue)"] as [string, unknown]]
          : []),
        ...(orphanResult ? [["Orphaned", orphanResult.orphanedCount] as [string, unknown]] : []),
      ]);
      console.log();
    } else {
      printJson(output);
    }
  } finally {
    ctx.close();
  }
}
