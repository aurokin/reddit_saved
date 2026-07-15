import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { paths, resolveDatabasePath } from "../src/utils/paths";

const originalDbPath = process.env.REDDIT_CACHED_DB;

describe("resolveDatabasePath", () => {
  beforeEach(() => {
    delete process.env.REDDIT_CACHED_DB;
  });

  afterEach(() => {
    if (originalDbPath === undefined) {
      delete process.env.REDDIT_CACHED_DB;
    } else {
      process.env.REDDIT_CACHED_DB = originalDbPath;
    }
  });

  test("override wins over env var and default", () => {
    process.env.REDDIT_CACHED_DB = "/env/reddit.db";
    expect(resolveDatabasePath("/flag/reddit.db")).toBe("/flag/reddit.db");
  });

  test("env var wins over the platform default", () => {
    process.env.REDDIT_CACHED_DB = "/env/reddit.db";
    expect(resolveDatabasePath()).toBe("/env/reddit.db");
  });

  test("env var is resolved to an absolute path", () => {
    process.env.REDDIT_CACHED_DB = "relative/reddit.db";
    expect(resolveDatabasePath()).toBe(resolve("relative/reddit.db"));
  });

  test("falls back to the platform default", () => {
    expect(resolveDatabasePath()).toBe(paths.database);
  });
});
