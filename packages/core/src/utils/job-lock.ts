import { hostname } from "node:os";
import { dirname } from "node:path";

/**
 * Cross-process job mutex using exclusive file creation (open "wx") — ported
 * from birdclaw's scheduled-job lock. Holding the lock means a scheduled or
 * manual pipeline run is in flight; contenders skip instead of queueing.
 *
 * The file's mtime is written once at acquire, so a lock older than staleMs
 * is treated as left behind by a crashed process and reclaimed.
 */

export type JobLockRelease = () => Promise<void>;

export const JOB_LOCK_STALE_MS = 2 * 60 * 60 * 1000;

export interface JobLockInfo {
  pid: number;
  host: string;
  /** epoch ms */
  startedAt: number;
}

/** Acquire the lock, or return undefined when another live process holds it. */
export async function acquireJobLock(
  lockPath: string,
  staleMs = JOB_LOCK_STALE_MS,
): Promise<JobLockRelease | undefined> {
  const fs = await import("node:fs/promises");

  const info: JobLockInfo = { pid: process.pid, host: hostname(), startedAt: Date.now() };

  // On a fresh machine the lock is acquired before anything has created the
  // data directory (the DB opens after the lock), so ensure it exists.
  await fs.mkdir(dirname(lockPath), { recursive: true });

  try {
    const handle = await fs.open(lockPath, "wx");
    await handle.writeFile(JSON.stringify(info));
    await handle.close();
    return async () => {
      await fs.rm(lockPath, { force: true });
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }

  // Held — reclaim only if stale.
  try {
    const stat = await fs.stat(lockPath);
    if (Date.now() - stat.mtimeMs <= staleMs) return undefined;
    await fs.rm(lockPath, { force: true });
  } catch {
    // Raced with the holder releasing — fall through and retry once.
  }

  try {
    const handle = await fs.open(lockPath, "wx");
    await handle.writeFile(JSON.stringify(info));
    await handle.close();
    return async () => {
      await fs.rm(lockPath, { force: true });
    };
  } catch {
    return undefined;
  }
}

/** Read the holder info from a lock file, or null when absent/unparseable. */
export async function readJobLock(lockPath: string): Promise<JobLockInfo | null> {
  try {
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile(lockPath, "utf8");
    const parsed = JSON.parse(raw) as JobLockInfo;
    return typeof parsed.pid === "number" ? parsed : null;
  } catch {
    return null;
  }
}
