import type { RedditApiClient } from "../api/client";
import type { SqliteAdapter } from "../storage/sqlite-adapter";
import type { PostRow, RedditItem, RedditItemData } from "../types";

/**
 * Thread-context capture: for each saved item, fetch the conversation around it
 * and store it as content_origin = 'context' rows in the same posts table.
 *
 * - Saved comment → its ancestor chain (the discussion it replied to).
 * - Saved post    → the top comments of its thread.
 *
 * Resumability is per-item via posts.context_fetched_at (epoch ms), stamped
 * only after the context rows were stored — a failed item retries next run.
 * No checkpoint file is involved.
 */

export interface ContextSyncOptions {
  /** Max saved items to process this run (default 50) */
  limit?: number;
  /** Max top comments stored per saved post (default 20) */
  topComments?: number;
  /** Minimum score for a post's comments to be captured (default 3) */
  minCommentScore?: number;
  /** Re-capture items whose context is older than this many days */
  refreshDays?: number;
  signal?: AbortSignal;
  onItem?: (processed: number, total: number, item: PostRow) => void;
  onError?: (item: PostRow, error: unknown) => void;
}

export interface ContextSyncResult {
  /** Saved items examined this run */
  processed: number;
  /** Saved items whose context was captured and stamped */
  captured: number;
  /** Context rows stored across all items */
  contextItemsStored: number;
  /** Items that errored (left unstamped, retried next run) */
  failed: number;
  /** Saved items still waiting after this run */
  remaining: number;
  wasCancelled: boolean;
}

export const CONTEXT_SYNC_DEFAULT_LIMIT = 50;
export const CONTEXT_SYNC_DEFAULT_TOP_COMMENTS = 20;
export const CONTEXT_SYNC_DEFAULT_MIN_COMMENT_SCORE = 3;
/** Ancestor depth requested for saved comments */
export const CONTEXT_SYNC_ANCESTOR_DEPTH = 8;

export async function syncContext(
  storage: SqliteAdapter,
  api: RedditApiClient,
  options: ContextSyncOptions = {},
): Promise<ContextSyncResult> {
  const limit = options.limit ?? CONTEXT_SYNC_DEFAULT_LIMIT;
  const topComments = options.topComments ?? CONTEXT_SYNC_DEFAULT_TOP_COMMENTS;
  const minCommentScore = options.minCommentScore ?? CONTEXT_SYNC_DEFAULT_MIN_COMMENT_SCORE;
  const refreshedBefore =
    options.refreshDays !== undefined
      ? Date.now() - options.refreshDays * 24 * 60 * 60 * 1000
      : undefined;

  const candidates = storage.getContextCandidates(limit, refreshedBefore);

  const result: ContextSyncResult = {
    processed: 0,
    captured: 0,
    contextItemsStored: 0,
    failed: 0,
    remaining: 0,
    wasCancelled: false,
  };

  for (const item of candidates) {
    if (options.signal?.aborted) {
      result.wasCancelled = true;
      break;
    }
    result.processed++;
    options.onItem?.(result.processed, candidates.length, item);

    try {
      const contextItems =
        item.kind === "t1"
          ? await fetchCommentContext(api, item, options.signal)
          : await fetchPostContext(api, item, topComments, minCommentScore, options.signal);

      storage.upsertContextItems(contextItems);
      storage.markContextFetched(item.id);
      result.captured++;
      result.contextItemsStored += contextItems.length;
    } catch (err) {
      if (options.signal?.aborted) {
        result.wasCancelled = true;
        result.processed--; // aborted mid-item: not examined to completion
        break;
      }
      result.failed++;
      options.onError?.(item, err);
    }
  }

  // How many candidates are still unstamped (includes this run's failures)
  result.remaining = storage.getContextCandidates(10_000, refreshedBefore).length;

  return result;
}

/** Ancestor chain of a saved comment, as storable 'context' items. */
async function fetchCommentContext(
  api: RedditApiClient,
  item: PostRow,
  signal?: AbortSignal,
): Promise<RedditItem[]> {
  const withContext = await api.fetchCommentWithContext(
    item.permalink,
    CONTEXT_SYNC_ANCESTOR_DEPTH,
    signal,
  );
  const ancestors = withContext?.parent_comments ?? [];
  return ancestors.filter(isStorableCommentData).map(toContextItem);
}

/** Top comments of a saved post's thread, as storable 'context' items. */
async function fetchPostContext(
  api: RedditApiClient,
  item: PostRow,
  topComments: number,
  minCommentScore: number,
  signal?: AbortSignal,
): Promise<RedditItem[]> {
  const thread = await api.fetchCommentThread(item.id, item.subreddit, "top", signal);
  if (!thread) return [];

  // flattenCommentTree order follows the "top"-sorted tree, so the first N
  // qualifying entries are the best top-level comments plus their best replies.
  return thread.comments
    .filter((c) => (c.score ?? 0) >= minCommentScore)
    .filter(isStorableCommentData)
    .slice(0, topComments)
    .map(toContextItem);
}

/** The mapper requires these fields; thread pages normally include all of
 *  them, but "more" stubs or deleted edge cases may not. */
function isStorableCommentData(data: RedditItemData): boolean {
  return Boolean(
    data.id && data.name && data.permalink && data.subreddit && data.created_utc !== undefined,
  );
}

function toContextItem(data: RedditItemData): RedditItem {
  // Trim the nested replies listing out of raw_json — descendants are stored
  // as their own rows, and the tree is reassembled via parent_id (getThread).
  const { replies: _replies, ...rest } = data;
  return {
    kind: "t1",
    data: { ...rest, author: rest.author ?? "[deleted]", score: rest.score ?? 0 },
  };
}
