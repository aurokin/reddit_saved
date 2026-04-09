import { mkdirSync } from "fs";
import { unlink, rename } from "fs/promises";
import { dirname } from "path";
import { paths } from "../utils/paths";

/**
 * In-flight checkpoint data for crash recovery during a fetch.
 * Written to a JSON file; deleted on successful completion.
 * Only exists while a fetch is in progress.
 */
export interface CheckpointData {
  sessionId: string;
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

  constructor(checkpointPath?: string) {
    this.checkpointPath = checkpointPath ?? paths.checkpoint;
    mkdirSync(dirname(this.checkpointPath), { recursive: true });
  }

  async load(): Promise<CheckpointData | null> {
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

    if (!isValidCheckpoint(parsed)) {
      await this.clear();
      return null;
    }

    return parsed;
  }

  async save(data: CheckpointData): Promise<void> {
    // Don't persist fetchedIds/failedIds — they can be large and are redundant
    // with cursor-based resumption + DB upsert dedup. Keep them in-memory only.
    const { fetchedIds: _f, failedIds: _d, ...rest } = data;
    const toWrite = { ...rest, fetchedIds: [] as string[], failedIds: [] as string[], updatedAt: Date.now() };
    const tmp = `${this.checkpointPath}.tmp`;
    try {
      await Bun.write(tmp, JSON.stringify(toWrite, null, 2));
      await rename(tmp, this.checkpointPath);
    } catch (err) {
      try { await unlink(tmp); } catch { /* best effort cleanup */ }
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

  createNew(sessionId?: string): CheckpointData {
    return {
      sessionId: sessionId ?? crypto.randomUUID(),
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

function isValidCheckpoint(value: unknown): value is CheckpointData {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.sessionId === "string" &&
    obj.sessionId.length <= 64 &&
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
