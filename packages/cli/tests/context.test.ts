import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SqliteAdapter } from "@reddit-saved/core";
import { setOutputMode } from "../src/output";
import { ExitCaptured, captureConsole, captureExit, makeTempDb } from "./helpers";

const originalEnv = { ...process.env };

describe("createContext", () => {
  let dbPath: string;
  let tempConfigDir: string;

  beforeEach(() => {
    // Redirect config dir to a temp dir so no real auth.json is found
    tempConfigDir = mkdtempSync(join(tmpdir(), "cli-ctx-test-"));
    process.env.XDG_CONFIG_HOME = tempConfigDir;
    process.env.XDG_DATA_HOME = tempConfigDir;
  });

  afterEach(() => {
    setOutputMode(false, false, false);
    // Restore env
    process.env.XDG_CONFIG_HOME = originalEnv.XDG_CONFIG_HOME;
    process.env.XDG_DATA_HOME = originalEnv.XDG_DATA_HOME;
    if (!originalEnv.XDG_CONFIG_HOME) process.env.XDG_CONFIG_HOME = undefined;
    if (!originalEnv.XDG_DATA_HOME) process.env.XDG_DATA_HOME = undefined;
    if (dbPath) {
      rmSync(dirname(dbPath), { recursive: true, force: true });
    }
    rmSync(tempConfigDir, { recursive: true, force: true });
  });

  test("creates storage with custom dbPath", async () => {
    dbPath = makeTempDb();
    const { createContext } = await import("../src/context");
    const ctx = await createContext({ dbPath });
    try {
      expect(ctx.storage).toBeInstanceOf(SqliteAdapter);
      expect(ctx.tags).toBeDefined();
      expect(ctx.monitor).toBeDefined();
      expect(ctx.apiClient).toBeUndefined();
    } finally {
      ctx.close();
    }
  });

  test("close() does not throw", async () => {
    dbPath = makeTempDb();
    const { createContext } = await import("../src/context");
    const ctx = await createContext({ dbPath });
    expect(() => ctx.close()).not.toThrow();
  });

  test("exits with code 2 when needsAuth and not authenticated", async () => {
    dbPath = makeTempDb();
    const { createContext } = await import("../src/context");
    const cap = captureConsole();
    const exit = captureExit();
    try {
      await createContext({ needsAuth: true, dbPath });
    } catch (e) {
      expect(e).toBeInstanceOf(ExitCaptured);
      expect((e as ExitCaptured).code).toBe(2);
    } finally {
      exit.restore();
      cap.restore();
    }
    expect(exit.exitCode).toBe(2);
    expect(cap.errors[0]).toContain("Not authenticated");
  });

  test("closes storage when tokenManager.load throws", async () => {
    dbPath = makeTempDb();
    // Create a corrupted auth.json to cause a parse error
    const configDir = join(tempConfigDir, "reddit-saved");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "auth.json"), "NOT VALID JSON {{{");
    process.env.REDDIT_CLIENT_SECRET = "test-secret";

    const { createContext } = await import("../src/context");
    let threw = false;
    try {
      await createContext({ needsAuth: true, dbPath });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    // Verify DB is not left locked — should be openable by another adapter
    const { SqliteAdapter: SA } = await import("@reddit-saved/core");
    const verify = new SA(dbPath);
    expect(() => verify.getStats()).not.toThrow();
    verify.close();
  });

  test("creates apiClient and queue when needsApi and authenticated", async () => {
    const configDir = join(tempConfigDir, "reddit-saved");
    const { mkdirSync: mkdirSyncFS, writeFileSync: writeFileSyncFS } = await import("node:fs");
    mkdirSyncFS(configDir, { recursive: true });
    writeFileSyncFS(
      join(configDir, "auth.json"),
      JSON.stringify({
        accessToken: "test-token",
        refreshToken: "test-refresh",
        tokenExpiry: Date.now() + 3600_000,
        username: "testuser",
        clientId: "test-client-id",
      }),
    );
    process.env.REDDIT_CLIENT_SECRET = "test-secret";

    dbPath = makeTempDb();
    const { createContext } = await import("../src/context");
    const ctx = await createContext({ needsApi: true, dbPath });
    try {
      expect(ctx.apiClient).toBeDefined();
      expect(ctx.queue).toBeDefined();
      expect(ctx.storage).toBeDefined();
      expect(ctx.tags).toBeDefined();
    } finally {
      ctx.close();
    }
  });
});
