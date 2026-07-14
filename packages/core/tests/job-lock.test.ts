import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireJobLock, readJobLock } from "../src/utils/job-lock";

describe("acquireJobLock", () => {
  let dir: string;
  let lockPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "reddit-cached-job-lock-"));
    lockPath = join(dir, ".reddit-jobs.lock");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("acquires and writes holder info", async () => {
    const release = await acquireJobLock(lockPath);
    expect(release).toBeDefined();
    expect(existsSync(lockPath)).toBe(true);

    const info = await readJobLock(lockPath);
    expect(info?.pid).toBe(process.pid);
    expect(typeof info?.startedAt).toBe("number");

    await release?.();
  });

  test("acquires when the data directory does not exist yet", async () => {
    const freshPath = join(dir, "data", ".reddit-jobs.lock");
    const release = await acquireJobLock(freshPath);
    expect(release).toBeDefined();
    expect(existsSync(freshPath)).toBe(true);
    await release?.();
  });

  test("second acquire fails while held", async () => {
    const release = await acquireJobLock(lockPath);
    expect(await acquireJobLock(lockPath)).toBeUndefined();
    await release?.();
  });

  test("release allows reacquire", async () => {
    const release = await acquireJobLock(lockPath);
    await release?.();
    expect(existsSync(lockPath)).toBe(false);

    const again = await acquireJobLock(lockPath);
    expect(again).toBeDefined();
    await again?.();
  });

  test("stale lock is reclaimed", async () => {
    const release = await acquireJobLock(lockPath);
    expect(release).toBeDefined();
    // Backdate the lock past the stale window
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
    utimesSync(lockPath, old, old);

    const reclaimed = await acquireJobLock(lockPath);
    expect(reclaimed).toBeDefined();
    await reclaimed?.();
  });

  test("fresh lock is not reclaimed even with a custom stale window", async () => {
    const release = await acquireJobLock(lockPath, 60_000);
    expect(await acquireJobLock(lockPath, 60_000)).toBeUndefined();
    await release?.();
  });

  test("readJobLock returns null for a missing file", async () => {
    expect(await readJobLock(lockPath)).toBeNull();
  });
});
