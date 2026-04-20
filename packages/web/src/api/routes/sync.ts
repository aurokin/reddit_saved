/**
 * Sync routes — fetch (SSE), status, unsave.
 */
import {
  type ApiClientCallbacks,
  type ContentOrigin,
  type CheckpointData,
  type FetchResult,
  type OrphanDetectionResult,
  RedditApiClient,
  SyncStateManager,
  detectOrphans,
  getCheckpointPathForDatabase,
} from "@reddit-saved/core";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import { getAppContext } from "../context";
import { assertLocalAppOrigin } from "../request-origin";

const app = new Hono();

function getCursorKey(origin: ContentOrigin): string {
  return `last_cursor_${origin}`;
}

function parseFetchOrigin(typeStr: string | undefined): ContentOrigin | null {
  if (!typeStr) return "saved";
  if (typeStr === "saved" || typeStr === "upvoted" || typeStr === "submitted") {
    return typeStr;
  }
  if (typeStr === "commented" || typeStr === "comments") {
    return "commented";
  }
  return null;
}

function isCheckpointCompatible(
  checkpoint: CheckpointData,
  origin: ContentOrigin,
  isFull: boolean,
): boolean {
  return checkpoint.contentOrigin === origin && checkpoint.isFull === isFull;
}

app.get("/status", (c) => {
  const ctx = getAppContext();
  const origins: ContentOrigin[] = ["saved", "upvoted", "submitted", "commented"];
  const incrementalCursors: Partial<Record<ContentOrigin, string | null>> = {};
  for (const o of origins) {
    incrementalCursors[o] = ctx.storage.getSyncState(getCursorKey(o));
  }
  const last = ctx.storage.getSyncState("last_sync_time");
  const lastFull = ctx.storage.getSyncState("last_full_sync_time");
  const stats = ctx.storage.getStats();
  return c.json({
    isRunning: ctx.activeSync !== null,
    lastSyncTime: last ? Number(last) : null,
    lastFullSyncTime: lastFull ? Number(lastFull) : null,
    incrementalCursors,
    stats,
  });
});

app.get("/fetch", (c) => {
  assertLocalAppOrigin(c, { allowEmptyOrigin: true });
  const ctx = getAppContext();
  const typeStr = c.req.query("type") ?? undefined;
  const origin = parseFetchOrigin(typeStr);
  if (!origin) {
    throw new HTTPException(400, {
      message: `Invalid sync type '${typeStr}'. Expected one of saved, upvoted, submitted, commented.`,
    });
  }
  if (ctx.activeSync) {
    throw new HTTPException(409, { message: "A sync is already in progress" });
  }
  if (ctx.testMode) {
    throw new HTTPException(400, {
      message: "Sync is disabled in TEST_MODE — the database is pre-seeded for tests.",
    });
  }

  const isFull = c.req.query("full") === "true";

  const controller = new AbortController();
  const abortSync = (): void => {
    controller.abort("sync client disconnected");
  };
  ctx.activeSync = controller;

  return streamSSE(c, async (stream) => {
    stream.onAbort(abortSync);
    c.req.raw.signal.addEventListener("abort", abortSync, { once: true });

    const send = async (event: string, data: Record<string, unknown>): Promise<void> => {
      await stream.writeSSE({ event, data: JSON.stringify(data) });
    };

    let fetched = 0;

    try {
      const stateManager = new SyncStateManager(getCheckpointPathForDatabase(ctx.dbPath));
      const loadedCheckpoint = await stateManager.load();
      let checkpoint =
        loadedCheckpoint && isCheckpointCompatible(loadedCheckpoint, origin, isFull)
          ? loadedCheckpoint
          : stateManager.createNew(undefined, {
              contentOrigin: origin,
              isFull,
            });

      await send("starting", { origin, full: isFull });

      const callbacks: ApiClientCallbacks = {
        onProgress: (f, total) => {
          fetched = f;
          void send("progress", { phase: "fetching", fetched: f, total });
        },
        onPageFetched: (pageNum, itemCount, cursor) => {
          void send("page", { pageNum, itemCount, cursor });
        },
        onRateLimit: (waitMs, remaining) => {
          void send("rate-limit", { waitMs, remaining });
        },
        onError: (error, retryable) => {
          if (retryable) void send("retry", { message: error.message });
        },
      };
      const syncClient = new RedditApiClient(
        await ctx.authProvider.createPinnedProvider(),
        ctx.queue,
        callbacks,
      );

      const fetchMethod = {
        saved: syncClient.fetchSaved.bind(syncClient),
        upvoted: syncClient.fetchUpvoted.bind(syncClient),
        submitted: syncClient.fetchUserPosts.bind(syncClient),
        commented: syncClient.fetchUserComments.bind(syncClient),
      }[origin];

      const storedCursor = isFull ? null : ctx.storage.getSyncState(getCursorKey(origin));
      const startCursor = checkpoint.cursor ?? storedCursor ?? undefined;
      checkpoint.contentOrigin = origin;
      checkpoint.isFull = isFull;
      checkpoint.cursor = startCursor ?? checkpoint.cursor ?? null;
      checkpoint.phase = "fetching";
      await stateManager.save(checkpoint);

      const syncStart = Date.now();
      const result: FetchResult = await fetchMethod({
        signal: controller.signal,
        startCursor,
      });

      if (result.items.length > 0) {
        checkpoint.phase = "storing";
        await stateManager.save(checkpoint);
        await send("progress", { phase: "storing", fetched: result.items.length });
        ctx.storage.upsertPosts(result.items, origin);
      }

      checkpoint.phase = "fetching";
      checkpoint.cursor = result.cursor;
      checkpoint.totalFetched += result.items.length;
      await stateManager.save(checkpoint);

      if (result.wasCancelled || result.wasErrored) {
        if (!isFull && result.cursor) {
          ctx.storage.setSyncState(getCursorKey(origin), result.cursor);
        }
        await send("incomplete", {
          reason: result.wasCancelled ? "cancelled" : "errored",
          fetched: result.items.length,
        });
      } else {
        ctx.storage.setSyncState("last_sync_time", String(syncStart));
        if (isFull) ctx.storage.setSyncState("last_full_sync_time", String(syncStart));
        if (!isFull && result.hasMore && result.cursor) {
          ctx.storage.setSyncState(getCursorKey(origin), result.cursor);
        } else {
          ctx.storage.deleteSyncState(getCursorKey(origin));
        }

        let orphan: OrphanDetectionResult | undefined;
        if (isFull) {
          checkpoint.phase = "cleanup";
          await stateManager.save(checkpoint);
          await send("progress", { phase: "cleanup" });
          orphan = detectOrphans(ctx.storage, syncStart, [origin]);
        }
        await send("complete", {
          fetched: result.items.length,
          hasMore: result.hasMore,
          orphaned: orphan?.orphanedCount ?? 0,
          reason: orphan?.reason,
        });
        await stateManager.clear();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await send("error", { message, fetched });
    } finally {
      c.req.raw.signal.removeEventListener("abort", abortSync);
      ctx.activeSync = null;
      await stream.close();
    }
  });
});

app.post("/cancel", (c) => {
  assertLocalAppOrigin(c, { allowEmptyOrigin: true });
  const ctx = getAppContext();
  if (!ctx.activeSync) {
    return c.json({ ok: false, reason: "no active sync" });
  }
  ctx.activeSync.abort();
  return c.json({ ok: true });
});

// Unsave lives under /api (plan: POST /api/unsave) — re-exported here; server.ts will mount separately.
export const unsaveHandler = new Hono();
unsaveHandler.post("/", async (c) => {
  assertLocalAppOrigin(c, { allowEmptyOrigin: true });
  const ctx = getAppContext();
  const body = (await c.req.json().catch(() => ({}))) as { ids?: string[]; confirm?: boolean };
  if (!body.ids || body.ids.length === 0) {
    throw new HTTPException(400, { message: "Missing 'ids' in body" });
  }
  if (!body.confirm) {
    throw new HTTPException(400, {
      message: "Unsave is destructive. Pass confirm: true to proceed.",
    });
  }

  if (ctx.testMode) {
    // TEST_MODE: only mark locally, skip Reddit API
    ctx.storage.markUnsaved(body.ids);
    return c.json({ succeeded: body.ids, failed: [], cancelled: false });
  }

  // Fullnames come from the posts table
  const rows = body.ids
    .map((id) => ctx.storage.getPost(id))
    .filter((r): r is NonNullable<typeof r> => r !== null);
  const fullnames = rows.map((r) => r.name);
  const postIdByFullname = new Map(rows.map((r) => [r.name, r.id]));

  const result = await ctx.apiClient.unsaveItems(fullnames);
  const succeededIds = rows
    .filter((r) => result.succeeded.includes(r.name))
    .map((r) => r.id);
  if (succeededIds.length > 0) ctx.storage.markUnsaved(succeededIds);

  return c.json({
    succeeded: succeededIds,
    failed: result.failed.map((f) => ({
      id: postIdByFullname.get(f.id) ?? f.id,
      error: f.error.message,
    })),
    cancelled: result.wasCancelled,
  });
});

export default app;
