import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { closeAppContext, getAppContext } from "@/api/context";
import { paths } from "@reddit-saved/core";

const originalDataDir = process.env.XDG_DATA_HOME;
const originalDbPath = process.env.REDDIT_SAVED_DB;

describe("web app context", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "reddit-saved-web-context-"));
    process.env.XDG_DATA_HOME = join(tempDir, "data");
    delete process.env.REDDIT_SAVED_DB;
    closeAppContext();
  });

  afterEach(() => {
    closeAppContext();
    if (originalDataDir === undefined) {
      delete process.env.XDG_DATA_HOME;
    } else {
      process.env.XDG_DATA_HOME = originalDataDir;
    }
    if (originalDbPath === undefined) {
      delete process.env.REDDIT_SAVED_DB;
    } else {
      process.env.REDDIT_SAVED_DB = originalDbPath;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("uses the shared core database path when REDDIT_SAVED_DB is unset", () => {
    const ctx = getAppContext();

    expect(ctx.dbPath).toBe(paths.database);
    expect(ctx.dbPath).not.toBe(resolve(process.cwd(), "dev-data/reddit-saved.db"));
  });
});
