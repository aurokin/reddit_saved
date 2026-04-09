import type { StorageAdapter } from "../types";
import { REDDIT_MAX_ITEMS, CONTENT_ORIGINS } from "../constants";

export interface OrphanDetectionResult {
  orphanedCount: number;
  skippedOrigins: string[];
  reason?: string;
}

/**
 * Mark items as orphaned if they weren't seen during the latest full sync.
 * Runs per-origin: only origins below REDDIT_MAX_ITEMS (1000) active items are checked.
 * Saturated origins are skipped since Reddit's API only returns the newest 1000 items
 * per endpoint — items beyond that window cannot be verified and would be falsely orphaned.
 */
export function detectOrphans(
  storage: StorageAdapter,
  syncStartTime: number,
): OrphanDetectionResult {
  const stats = storage.getStats();

  const saturatedOrigins: string[] = [];
  let totalOrphaned = 0;

  for (const origin of CONTENT_ORIGINS) {
    const count = stats.activeCountByOrigin[origin] ?? 0;
    if (count >= REDDIT_MAX_ITEMS) {
      saturatedOrigins.push(origin);
    } else {
      totalOrphaned += storage.markOrphaned(syncStartTime, origin);
    }
  }

  return {
    orphanedCount: totalOrphaned,
    skippedOrigins: saturatedOrigins,
    ...(saturatedOrigins.length > 0
      ? { reason: `Reddit's API limits results to ${REDDIT_MAX_ITEMS} items per endpoint. Origin(s) at limit: ${saturatedOrigins.join(", ")}. Orphan detection skipped for these origins.` }
      : {}),
  };
}
