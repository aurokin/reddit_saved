import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SyncStateManager } from "../src/sync/state-manager";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "reddit-saved-state-test-"));
}

function makeCheckpointFixture(overrides: Record<string, unknown> = {}, now = Date.now()) {
  return {
    sessionId: "ok",
    contentOrigin: "saved",
    isFull: false,
    phase: "fetching",
    cursor: null,
    totalFetched: 0,
    fetchedIds: [],
    failedIds: [],
    startedAt: now,
    updatedAt: now,
    ...overrides,
  };
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
    expect(cp.contentOrigin).toBe("saved");
    expect(cp.isFull).toBe(false);
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

  test("createNew accepts checkpoint metadata", () => {
    const cp = manager.createNew("my-session", { contentOrigin: "upvoted", isFull: true });
    expect(cp.sessionId).toBe("my-session");
    expect(cp.contentOrigin).toBe("upvoted");
    expect(cp.isFull).toBe(true);
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
    expect(loaded?.contentOrigin).toBe("saved");
    expect(loaded?.isFull).toBe(false);
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

  test("load rejects legacy checkpoints missing contentOrigin and isFull", async () => {
    const now = Date.now();
    const {
      contentOrigin: _contentOrigin,
      isFull: _isFull,
      ...legacyCheckpoint
    } = makeCheckpointFixture(
      { sessionId: "legacy-session", cursor: "legacy_cursor_123", totalFetched: 7 },
      now,
    );

    writeFileSync(checkpointPath, JSON.stringify(legacyCheckpoint));

    const loaded = await manager.load();
    expect(loaded).toBeNull();
    expect(await Bun.file(checkpointPath).exists()).toBe(false);
  });

  test("load accepts sessionId at exactly 64 characters", async () => {
    const now = Date.now();
    writeFileSync(
      checkpointPath,
      JSON.stringify(makeCheckpointFixture({ sessionId: "a".repeat(64), cursor: "" }, now)),
    );
    const loaded = await manager.load();
    expect(loaded).not.toBeNull();
    expect(loaded?.sessionId).toBe("a".repeat(64));
  });

  test("load rejects sessionId exceeding 64 characters", async () => {
    writeFileSync(
      checkpointPath,
      JSON.stringify(makeCheckpointFixture({ sessionId: "a".repeat(65), cursor: "" })),
    );
    const loaded = await manager.load();
    expect(loaded).toBeNull();
    expect(await Bun.file(checkpointPath).exists()).toBe(false);
  });

  test("load rejects negative totalFetched", async () => {
    writeFileSync(
      checkpointPath,
      JSON.stringify(makeCheckpointFixture({ cursor: "", totalFetched: -1 })),
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

  test("clear propagates non-ENOENT errors", async () => {
    // Save a checkpoint so the file exists
    const cp = manager.createNew("test");
    await manager.save(cp);

    // Make the parent directory read-only to trigger EACCES on unlink
    const dir = dirname(checkpointPath);
    chmodSync(dir, 0o444);

    try {
      await expect(manager.clear()).rejects.toThrow();
    } finally {
      // Restore permissions for cleanup
      chmodSync(dir, 0o755);
    }
  });

  test("load cleans up orphaned .tmp file", async () => {
    const tmpPath = `${checkpointPath}.tmp`;
    writeFileSync(tmpPath, "orphaned temp data");

    // load() should delete the .tmp file as part of its cleanup
    const loaded = await manager.load();
    expect(loaded).toBeNull(); // no checkpoint file exists

    // Verify .tmp was cleaned up
    expect(await Bun.file(tmpPath).exists()).toBe(false);
  });

  test("load succeeds when no .tmp file exists", async () => {
    const cp = manager.createNew("test-session");
    await manager.save(cp);
    const loaded = await manager.load();
    expect(loaded).not.toBeNull();
    expect(loaded?.sessionId).toBe("test-session");
  });

  test("load normalizes populated fetchedIds/failedIds from external checkpoint", async () => {
    const now = Date.now();
    writeFileSync(
      checkpointPath,
      JSON.stringify(
        makeCheckpointFixture(
          {
            sessionId: "external",
            totalFetched: 5,
            fetchedIds: ["a", "b", "c"],
            failedIds: ["d"],
          },
          now,
        ),
      ),
    );
    const loaded = await manager.load();
    expect(loaded).not.toBeNull();
    expect(loaded?.sessionId).toBe("external");
    // Arrays should be normalized to empty regardless of what was on disk
    expect(loaded?.fetchedIds).toEqual([]);
    expect(loaded?.failedIds).toEqual([]);
  });

  test("concurrent save() calls serialize correctly", async () => {
    const cp1 = manager.createNew("session-1");
    cp1.totalFetched = 10;
    const cp2 = manager.createNew("session-2");
    cp2.totalFetched = 20;
    const cp3 = manager.createNew("session-3");
    cp3.totalFetched = 30;

    // Fire all three saves concurrently
    await Promise.all([manager.save(cp1), manager.save(cp2), manager.save(cp3)]);

    const loaded = await manager.load();
    expect(loaded).not.toBeNull();
    // Last writer wins — session-3 was queued last
    expect(loaded?.sessionId).toBe("session-3");
    expect(loaded?.totalFetched).toBe(30);
  });

  // -----------------------------------------------------------------------
  // New coverage: validation edge cases
  // -----------------------------------------------------------------------

  test("load rejects startedAt: 0", async () => {
    const now = Date.now();
    writeFileSync(checkpointPath, JSON.stringify(makeCheckpointFixture({ startedAt: 0 }, now)));
    const loaded = await manager.load();
    expect(loaded).toBeNull();
    expect(await Bun.file(checkpointPath).exists()).toBe(false);
  });

  test("load rejects updatedAt: 0", async () => {
    const now = Date.now();
    writeFileSync(checkpointPath, JSON.stringify(makeCheckpointFixture({ updatedAt: 0 }, now)));
    const loaded = await manager.load();
    expect(loaded).toBeNull();
    expect(await Bun.file(checkpointPath).exists()).toBe(false);
  });

  test("load rejects non-integer updatedAt", async () => {
    const now = Date.now();
    writeFileSync(checkpointPath, JSON.stringify(makeCheckpointFixture({ updatedAt: 1.5 }, now)));
    const loaded = await manager.load();
    expect(loaded).toBeNull();
    expect(await Bun.file(checkpointPath).exists()).toBe(false);
  });

  test("load rejects non-array fetchedIds", async () => {
    const now = Date.now();
    writeFileSync(
      checkpointPath,
      JSON.stringify(makeCheckpointFixture({ fetchedIds: "not-array" }, now)),
    );
    const loaded = await manager.load();
    expect(loaded).toBeNull();
    expect(await Bun.file(checkpointPath).exists()).toBe(false);
  });

  test("load rejects cursor exceeding 200 characters", async () => {
    const now = Date.now();
    writeFileSync(
      checkpointPath,
      JSON.stringify(makeCheckpointFixture({ cursor: "x".repeat(201) }, now)),
    );
    const loaded = await manager.load();
    expect(loaded).toBeNull();
  });

  test("load accepts cursor at exactly 200 characters", async () => {
    const now = Date.now();
    writeFileSync(
      checkpointPath,
      JSON.stringify(makeCheckpointFixture({ cursor: "x".repeat(200) }, now)),
    );
    const loaded = await manager.load();
    expect(loaded).not.toBeNull();
  });

  test("load rejects fetchedIds exceeding 10000 entries", async () => {
    const now = Date.now();
    writeFileSync(
      checkpointPath,
      JSON.stringify(
        makeCheckpointFixture(
          { fetchedIds: Array.from({ length: 10001 }, (_, i) => `id${i}`) },
          now,
        ),
      ),
    );
    const loaded = await manager.load();
    expect(loaded).toBeNull();
  });

  test("load rejects fetchedIds containing strings over 20 chars", async () => {
    const now = Date.now();
    writeFileSync(
      checkpointPath,
      JSON.stringify(makeCheckpointFixture({ fetchedIds: ["a".repeat(21)] }, now)),
    );
    const loaded = await manager.load();
    expect(loaded).toBeNull();
  });

  test("load rejects invalid phase values", async () => {
    const now = Date.now();
    writeFileSync(
      checkpointPath,
      JSON.stringify(makeCheckpointFixture({ phase: "invalid_phase" }, now)),
    );
    const loaded = await manager.load();
    expect(loaded).toBeNull();
  });

  test("cursor: null round-trips correctly", async () => {
    const cp = manager.createNew();
    expect(cp.cursor).toBeNull();

    await manager.save(cp);
    const loaded = await manager.load();
    expect(loaded).not.toBeNull();
    if (!loaded) {
      throw new Error("Expected checkpoint to load");
    }
    expect(loaded.cursor).toBeNull();
  });

  test("load rejects failedIds exceeding 10000 entries", async () => {
    const now = Date.now();
    writeFileSync(
      checkpointPath,
      JSON.stringify(
        makeCheckpointFixture(
          { failedIds: Array.from({ length: 10001 }, (_, i) => `id${i}`) },
          now,
        ),
      ),
    );
    const loaded = await manager.load();
    expect(loaded).toBeNull();
    expect(await Bun.file(checkpointPath).exists()).toBe(false);
  });

  test("load rejects failedIds containing strings over 20 chars", async () => {
    const now = Date.now();
    writeFileSync(
      checkpointPath,
      JSON.stringify(makeCheckpointFixture({ failedIds: ["a".repeat(21)] }, now)),
    );
    const loaded = await manager.load();
    expect(loaded).toBeNull();
    expect(await Bun.file(checkpointPath).exists()).toBe(false);
  });

  test("load rejects non-integer totalFetched (float)", async () => {
    const now = Date.now();
    writeFileSync(
      checkpointPath,
      JSON.stringify(makeCheckpointFixture({ totalFetched: 1.5 }, now)),
    );
    const loaded = await manager.load();
    expect(loaded).toBeNull();
    expect(await Bun.file(checkpointPath).exists()).toBe(false);
  });

  test("save fails for read-only directory", async () => {
    const { chmodSync } = await import("node:fs");
    const readonlyDir = makeTempDir();
    const readonlyPath = join(readonlyDir, "subdir", "checkpoint.json");
    // Create the subdir then make it read-only
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(readonlyDir, "subdir"), { recursive: true });
    chmodSync(join(readonlyDir, "subdir"), 0o444);

    const readonlyManager = new SyncStateManager(readonlyPath);
    const cp = readonlyManager.createNew();

    try {
      await expect(readonlyManager.save(cp)).rejects.toThrow();
    } finally {
      // Restore permissions for cleanup
      chmodSync(join(readonlyDir, "subdir"), 0o755);
      rmSync(readonlyDir, { recursive: true, force: true });
    }
  });

  test("concurrent save calls are serialized — second save's data wins", async () => {
    const cp1 = manager.createNew("session-1");
    cp1.cursor = "cursor-1";
    cp1.totalFetched = 10;

    const cp2 = manager.createNew("session-2");
    cp2.cursor = "cursor-2";
    cp2.totalFetched = 20;

    // Fire both saves concurrently
    await Promise.all([manager.save(cp1), manager.save(cp2)]);

    const loaded = await manager.load();
    expect(loaded).not.toBeNull();
    if (!loaded) {
      throw new Error("Expected checkpoint to load");
    }
    // Second save should win since saves are serialized
    expect(loaded.sessionId).toBe("session-2");
    expect(loaded.cursor).toBe("cursor-2");
    expect(loaded.totalFetched).toBe(20);
  });

  test("multiple rapid saves all complete without data corruption", async () => {
    // Fire 5 rapid saves — only the last one's data should persist
    const saves: Promise<void>[] = [];
    for (let i = 0; i < 5; i++) {
      const cp = manager.createNew(`session-${i}`);
      cp.cursor = `cursor-${i}`;
      cp.totalFetched = i * 10;
      saves.push(manager.save(cp));
    }
    await Promise.all(saves);

    const loaded = await manager.load();
    expect(loaded).not.toBeNull();
    if (!loaded) {
      throw new Error("Expected checkpoint to load");
    }
    // Last save should win
    expect(loaded.sessionId).toBe("session-4");
    expect(loaded.cursor).toBe("cursor-4");
    expect(loaded.totalFetched).toBe(40);
  });

  test("onSaveError callback fires when a subsequent save follows a failed one", async () => {
    const saveErrors: unknown[] = [];
    const tempDir = makeTempDir();
    const cpPath = join(tempDir, "subdir", "checkpoint.json");
    const errorManager = new SyncStateManager(cpPath, (err) => saveErrors.push(err));

    const cp1 = errorManager.createNew("session-ok");
    // First save succeeds (directory was created by constructor)
    await errorManager.save(cp1);

    // Make the directory read-only so the next save will fail
    chmodSync(dirname(cpPath), 0o444);

    const cp2 = errorManager.createNew("session-fail");
    try {
      await errorManager.save(cp2);
    } catch {
      // Expected: this save fails due to read-only directory
    }

    // onSaveError hasn't fired yet — it fires when the *next* save starts
    expect(saveErrors.length).toBe(0);

    // Restore permissions so the recovery save can succeed
    chmodSync(dirname(cpPath), 0o755);

    // This save triggers onSaveError for the previous failure before proceeding
    const cp3 = errorManager.createNew("session-recover");
    await errorManager.save(cp3);

    expect(saveErrors.length).toBe(1);

    const loaded = await errorManager.load();
    expect(loaded).not.toBeNull();
    if (!loaded) {
      throw new Error("Expected checkpoint to load");
    }
    expect(loaded.sessionId).toBe("session-recover");

    rmSync(tempDir, { recursive: true, force: true });
  });

  test("onSaveError is optional — saves work without it", async () => {
    const noCallbackManager = new SyncStateManager(join(makeTempDir(), "cp.json"));
    const cp = noCallbackManager.createNew("session-no-cb");
    await noCallbackManager.save(cp);
    const loaded = await noCallbackManager.load();
    expect(loaded).not.toBeNull();
    if (!loaded) {
      throw new Error("Expected checkpoint to load");
    }
    expect(loaded.sessionId).toBe("session-no-cb");
  });

  test("console.warn fires when save fails without onSaveError callback", async () => {
    const tempDir = makeTempDir();
    const cpPath = join(tempDir, "subdir", "checkpoint.json");
    const noCallbackManager = new SyncStateManager(cpPath);

    const cp1 = noCallbackManager.createNew("session-ok");
    await noCallbackManager.save(cp1);

    // Make directory read-only so next save fails
    chmodSync(dirname(cpPath), 0o444);

    const cp2 = noCallbackManager.createNew("session-fail");
    try {
      await noCallbackManager.save(cp2);
    } catch {
      // Expected failure
    }

    // Restore permissions and spy on console.warn
    chmodSync(dirname(cpPath), 0o755);
    const warnSpy = mock(() => {});
    const origWarn = console.warn;
    console.warn = warnSpy as unknown as typeof console.warn;

    try {
      // This save triggers the warn for the previous failure
      const cp3 = noCallbackManager.createNew("session-recover");
      await noCallbackManager.save(cp3);
      expect(warnSpy).toHaveBeenCalled();
      expect(warnSpy.mock.calls[0]?.[0]).toContain("SyncStateManager");
    } finally {
      console.warn = origWarn;
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("onSaveError callback prevents console.warn", async () => {
    const saveErrors: unknown[] = [];
    const tempDir = makeTempDir();
    const cpPath = join(tempDir, "subdir", "checkpoint.json");
    const errorManager = new SyncStateManager(cpPath, (err) => saveErrors.push(err));

    const cp1 = errorManager.createNew("session-ok");
    await errorManager.save(cp1);

    // Make directory read-only so next save fails
    chmodSync(dirname(cpPath), 0o444);

    const cp2 = errorManager.createNew("session-fail");
    try {
      await errorManager.save(cp2);
    } catch {
      // Expected failure
    }

    // Restore permissions and spy on console.warn
    chmodSync(dirname(cpPath), 0o755);
    const warnSpy = mock(() => {});
    const origWarn = console.warn;
    console.warn = warnSpy as unknown as typeof console.warn;

    try {
      const cp3 = errorManager.createNew("session-recover");
      await errorManager.save(cp3);
      // onSaveError should receive the error, not console.warn
      expect(saveErrors.length).toBe(1);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      console.warn = origWarn;
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
