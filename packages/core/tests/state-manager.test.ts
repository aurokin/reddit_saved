import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SyncStateManager } from "../src/sync/state-manager";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "reddit-saved-state-test-"));
}

describe("SyncStateManager", () => {
  let dir: string;
  let checkpointPath: string;
  let manager: SyncStateManager;

  beforeEach(() => {
    dir = makeTempDir();
    checkpointPath = join(dir, "checkpoint.json");
    manager = new SyncStateManager(checkpointPath);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("createNew returns valid checkpoint with defaults", () => {
    const cp = manager.createNew();
    expect(cp.sessionId).toBeDefined();
    expect(cp.sessionId.length).toBeGreaterThan(0);
    expect(cp.cursor).toBeNull();
    expect(cp.fetchedIds).toEqual([]);
    expect(cp.failedIds).toEqual([]);
    expect(cp.totalFetched).toBe(0);
    expect(cp.phase).toBe("fetching");
    expect(cp.startedAt).toBeGreaterThan(0);
    expect(cp.updatedAt).toBeGreaterThan(0);
  });

  test("createNew accepts custom sessionId", () => {
    const cp = manager.createNew("my-session");
    expect(cp.sessionId).toBe("my-session");
  });

  test("save and load round-trips", async () => {
    const cp = manager.createNew("roundtrip-test");
    cp.cursor = "abc_cursor";
    cp.totalFetched = 42;
    cp.phase = "storing";

    await manager.save(cp);
    const loaded = await manager.load();

    expect(loaded).not.toBeNull();
    expect(loaded?.sessionId).toBe("roundtrip-test");
    expect(loaded?.cursor).toBe("abc_cursor");
    expect(loaded?.totalFetched).toBe(42);
    expect(loaded?.phase).toBe("storing");
    expect(loaded?.startedAt).toBe(cp.startedAt);
  });

  test("save strips fetchedIds and failedIds", async () => {
    const cp = manager.createNew();
    cp.fetchedIds = ["a", "b", "c"];
    cp.failedIds = ["d"];

    await manager.save(cp);
    const loaded = await manager.load();

    expect(loaded?.fetchedIds).toEqual([]);
    expect(loaded?.failedIds).toEqual([]);
  });

  test("load returns null when no checkpoint file exists", async () => {
    const loaded = await manager.load();
    expect(loaded).toBeNull();
  });

  test("load returns null and deletes file when JSON is corrupt", async () => {
    writeFileSync(checkpointPath, "not valid json{{{");
    const loaded = await manager.load();
    expect(loaded).toBeNull();
    // File should be cleaned up
    expect(await Bun.file(checkpointPath).exists()).toBe(false);
  });

  test("load returns null for invalid checkpoint data and deletes file", async () => {
    writeFileSync(checkpointPath, JSON.stringify({ sessionId: 123 }));
    const loaded = await manager.load();
    expect(loaded).toBeNull();
    expect(await Bun.file(checkpointPath).exists()).toBe(false);
  });

  test("load accepts sessionId at exactly 64 characters", async () => {
    const now = Date.now();
    writeFileSync(
      checkpointPath,
      JSON.stringify({
        sessionId: "a".repeat(64),
        phase: "fetching",
        cursor: "",
        totalFetched: 0,
        fetchedIds: [],
        failedIds: [],
        startedAt: now,
        updatedAt: now,
      }),
    );
    const loaded = await manager.load();
    expect(loaded).not.toBeNull();
    expect(loaded?.sessionId).toBe("a".repeat(64));
  });

  test("load rejects sessionId exceeding 64 characters", async () => {
    writeFileSync(
      checkpointPath,
      JSON.stringify({
        sessionId: "a".repeat(65),
        phase: "fetching",
        cursor: "",
        totalFetched: 0,
        fetchedIds: [],
        failedIds: [],
        startedAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const loaded = await manager.load();
    expect(loaded).toBeNull();
    expect(await Bun.file(checkpointPath).exists()).toBe(false);
  });

  test("load rejects negative totalFetched", async () => {
    writeFileSync(
      checkpointPath,
      JSON.stringify({
        sessionId: "ok",
        phase: "fetching",
        cursor: "",
        totalFetched: -1,
        fetchedIds: [],
        failedIds: [],
        startedAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const loaded = await manager.load();
    expect(loaded).toBeNull();
    expect(await Bun.file(checkpointPath).exists()).toBe(false);
  });

  test("load returns null for missing required fields and deletes file", async () => {
    writeFileSync(
      checkpointPath,
      JSON.stringify({
        sessionId: "ok",
        // missing phase, cursor, etc.
      }),
    );
    const loaded = await manager.load();
    expect(loaded).toBeNull();
    expect(await Bun.file(checkpointPath).exists()).toBe(false);
  });

  test("save refreshes updatedAt", async () => {
    const cp = manager.createNew();
    const originalUpdatedAt = cp.updatedAt;

    // Delay so Date.now() advances — 50ms is safe even on slow CI runners
    await new Promise((r) => setTimeout(r, 50));

    await manager.save(cp);
    const loaded = await manager.load();
    expect(loaded).not.toBeNull();
    // Strict > (not >= +1) handles 15ms clock granularity on some platforms
    expect(loaded?.updatedAt).toBeGreaterThan(originalUpdatedAt);
  });

  test("clear deletes the checkpoint file", async () => {
    const cp = manager.createNew();
    await manager.save(cp);
    expect(await Bun.file(checkpointPath).exists()).toBe(true);

    await manager.clear();
    expect(await Bun.file(checkpointPath).exists()).toBe(false);
  });

  test("clear is a no-op when file does not exist", async () => {
    // Should not throw
    await manager.clear();
  });
});
