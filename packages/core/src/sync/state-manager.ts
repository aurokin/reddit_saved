import { mkdirSync } from "node:fs";
import { rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { ContentOrigin } from "../types";
import { paths } from "../utils/paths";

/**
 * In-flight checkpoint data for crash recovery during a fetch.
 * Written to a JSON file; deleted on successful completion.
 * Only exists while a fetch is in progress.
 */
export interface CheckpointData {
  sessionId: string;
  contentOrigin: ContentOrigin;
  isFull: boolean;
  cursor: string | null;
  fetchedIds: string[];
  failedIds: string[];
  totalFetched: number;
  phase: "fetching" | "storing" | "cleanup";
  startedAt: number;
  updatedAt: number;
}

export class SyncStateManager {
  private checkpointPath: string;
  private savePromise: Promise<void> = Promise.resolve();
  private onSaveError?: (error: unknown) => void;

  constructor(checkpointPath?: string, onSaveError?: (error: unknown) => void) {
    this.checkpointPath = checkpointPath ?? paths.checkpoint;
    this.onSaveError = onSaveError;
    mkdirSync(dirname(this.checkpointPath), { recursive: true });
  }

  /** Load checkpoint from disk. Returns null if no checkpoint exists or it's corrupt.
   *  Note: fetchedIds/failedIds are not persisted — after crash recovery, progress
   *  tracking restarts from 0. Items are deduplicated via storage upsert. */
  async load(): Promise<CheckpointData | null> {
    // Best-effort cleanup of orphaned .tmp file from a previous interrupted save()
    try {
      await unlink(`${this.checkpointPath}.tmp`);
    } catch {
      // Expected: .tmp usually doesn't exist
    }

    const file = Bun.file(this.checkpointPath);
    if (!(await file.exists())) return null;

    let parsed: unknown;
    try {
      parsed = await file.json();
    } catch {
      // Corrupt checkpoint (truncated write, bad JSON) — remove and start fresh
      await this.clear();
      return null;
    }

    const checkpoint = normalizeCheckpoint(parsed);
    if (!checkpoint) {
      await this.clear();
      return null;
    }

    // Normalize: save() always writes empty arrays, but external/older
    // checkpoints may have populated arrays. Normalize to match save() contract.
    checkpoint.fetchedIds = [];
    checkpoint.failedIds = [];

    return checkpoint;
  }

  async save(data: CheckpointData): Promise<void> {
    const prev = this.savePromise;
    const onErr = this.onSaveError;
    const current = prev
      .catch((err) => {
        if (onErr) {
          onErr(err);
        } else {
          console.warn("SyncStateManager: save failed (no onSaveError handler)", err);
        }
      })
      .then(() => this._doSave(data));
    // Store the raw promise so the next save's .catch() can surface this save's error.
    // Attach a no-op handler to prevent unhandled rejection if no subsequent save follows.
    this.savePromise = current;
    current.catch(() => {});
    return current;
  }

  private async _doSave(data: CheckpointData): Promise<void> {
    // Don't persist fetchedIds/failedIds — they can be large and are redundant
    // with cursor-based resumption + DB upsert dedup. Keep them in-memory only.
    const { fetchedIds: _f, failedIds: _d, ...rest } = data;
    const toWrite = {
      ...rest,
      fetchedIds: [] as string[],
      failedIds: [] as string[],
      updatedAt: Date.now(),
    };
    const tmp = `${this.checkpointPath}.tmp`;
    try {
      await Bun.write(tmp, JSON.stringify(toWrite, null, 2));
      await rename(tmp, this.checkpointPath);
    } catch (err) {
      try {
        await unlink(tmp);
      } catch {
        /* best effort cleanup */
      }
      throw err;
    }
  }

  async clear(): Promise<void> {
    try {
      await unlink(this.checkpointPath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  createNew(
    sessionId?: string,
    options?: {
      contentOrigin?: ContentOrigin;
      isFull?: boolean;
    },
  ): CheckpointData {
    return {
      sessionId: sessionId ?? crypto.randomUUID(),
      contentOrigin: options?.contentOrigin ?? "saved",
      isFull: options?.isFull ?? false,
      cursor: null,
      fetchedIds: [],
      failedIds: [],
      totalFetched: 0,
      phase: "fetching",
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };
  }
}

const VALID_PHASES = new Set(["fetching", "storing", "cleanup"]);

function normalizeCheckpoint(value: unknown): CheckpointData | null {
  if (typeof value !== "object" || value === null) return null;
  return isValidCheckpoint(value) ? (value as CheckpointData) : null;
}

function isValidCheckpoint(value: unknown): value is CheckpointData {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.sessionId === "string" &&
    obj.sessionId.length <= 64 &&
    (obj.contentOrigin === "saved" ||
      obj.contentOrigin === "upvoted" ||
      obj.contentOrigin === "submitted" ||
      obj.contentOrigin === "commented") &&
    typeof obj.isFull === "boolean" &&
    typeof obj.phase === "string" &&
    VALID_PHASES.has(obj.phase) &&
    (obj.cursor === null || (typeof obj.cursor === "string" && obj.cursor.length <= 200)) &&
    Array.isArray(obj.fetchedIds) &&
    obj.fetchedIds.length <= 10_000 &&
    obj.fetchedIds.every((v: unknown) => typeof v === "string" && (v as string).length <= 20) &&
    Array.isArray(obj.failedIds) &&
    obj.failedIds.length <= 10_000 &&
    obj.failedIds.every((v: unknown) => typeof v === "string" && (v as string).length <= 20) &&
    Number.isInteger(obj.totalFetched) &&
    (obj.totalFetched as number) >= 0 &&
    Number.isInteger(obj.startedAt) &&
    (obj.startedAt as number) > 0 &&
    Number.isInteger(obj.updatedAt) &&
    (obj.updatedAt as number) > 0
  );
}
