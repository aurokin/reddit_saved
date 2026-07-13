import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { RedditApiClient, type RedditItem, SqliteAdapter } from "@reddit-cached/core";
import { setOutputMode } from "../src/output";
import { ExitCaptured, captureConsole, captureExit, makeItem, makeTempDb } from "./helpers";

const originalEnv = { ...process.env };
const originalFetchItems = RedditApiClient.prototype.fetchItemsByFullnames;

describe("import command", () => {
  let dbPath: string;
  let tempDir: string;
  let exportDir: string;
  let fetchCalls: string[][];

  beforeEach(() => {
    dbPath = makeTempDb();
    tempDir = dirname(dbPath);
    exportDir = join(tempDir, "export");
    mkdirSync(exportDir, { recursive: true });
    setOutputMode(false, false, false);

    // OAuth credentials so createContext({ needsApi: true }) succeeds
    const configDir = join(tempDir, "reddit-cached");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "auth.json"),
      JSON.stringify({
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token",
        tokenExpiry: Date.now() + 3600_000,
        username: "testuser",
        clientId: "test-client-id",
      }),
    );
    process.env.REDDIT_CACHED_CONFIG_DIR = configDir;
    process.env.XDG_DATA_HOME = tempDir;
    process.env.REDDIT_CLIENT_SECRET = "test-secret";

    fetchCalls = [];
    RedditApiClient.prototype.fetchItemsByFullnames = async (fullnames: string[]) => {
      fetchCalls.push([...fullnames]);
      return fullnames.map(
        (fullname): RedditItem => makeItem({ id: fullname.slice(3), kind: fullname.slice(0, 2) }),
      );
    };
  });

  afterEach(() => {
    RedditApiClient.prototype.fetchItemsByFullnames = originalFetchItems;
    setOutputMode(false, false, false);
    for (const key of ["REDDIT_CACHED_CONFIG_DIR", "XDG_DATA_HOME", "REDDIT_CLIENT_SECRET"]) {
      if (originalEnv[key] !== undefined) {
        process.env[key] = originalEnv[key];
      } else {
        delete process.env[key];
      }
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  async function runImport(
    flags: Record<string, string | boolean>,
    positionals: string[],
  ): Promise<{ logs: string[]; errors: string[]; exitCode: number | null }> {
    const { importCmd } = await import("../src/commands/import");
    const cap = captureConsole();
    const exit = captureExit();
    try {
      await importCmd({ db: dbPath, ...flags }, positionals);
    } catch (e) {
      if (!(e instanceof ExitCaptured)) throw e;
    } finally {
      exit.restore();
      cap.restore();
    }
    return { logs: cap.logs, errors: cap.errors, exitCode: exit.exitCode };
  }

  test("imports an export directory and prints a JSON summary", async () => {
    writeFileSync(
      join(exportDir, "saved_posts.csv"),
      "id,permalink\naaa,https://www.reddit.com/r/testsub/comments/aaa/x/\n",
    );

    const { logs, exitCode } = await runImport({}, [exportDir]);

    expect(exitCode).toBeNull();
    const output = JSON.parse(logs.join("\n"));
    expect(output.perOrigin).toEqual([
      { origin: "saved", found: 1, alreadyPresent: 0, hydrated: 1, deletedStubs: 0 },
    ]);
    expect(fetchCalls).toEqual([["t3_aaa"]]);

    const adapter = new SqliteAdapter(dbPath);
    try {
      expect(adapter.getPost("aaa")?.content_origin).toBe("saved");
    } finally {
      adapter.close();
    }
  });

  test("errors with an unzip hint when given a .zip file", async () => {
    const zipPath = join(tempDir, "export.zip");
    writeFileSync(zipPath, "PK\x03\x04");

    const { errors, exitCode } = await runImport({}, [zipPath]);

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("Unzip it first");
    expect(fetchCalls).toEqual([]);
  });

  test("errors when the directory is missing", async () => {
    const { errors, exitCode } = await runImport({}, [join(tempDir, "nope")]);

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("No such file or directory");
  });

  test("errors when no directory argument is given", async () => {
    const { errors, exitCode } = await runImport({}, []);

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("Usage: reddit-cached import");
  });

  test("rejects invalid --types values", async () => {
    const { errors, exitCode } = await runImport({ types: "saved,bogus" }, [exportDir]);

    expect(exitCode).toBe(1);
    const message = errors.join("\n");
    expect(message).toContain("Invalid --types value");
    expect(message).toContain("bogus");
    expect(fetchCalls).toEqual([]);
  });

  test("--types restricts which origins run", async () => {
    writeFileSync(
      join(exportDir, "saved_posts.csv"),
      "id,permalink\nsp,https://www.reddit.com/r/a/comments/sp/x/\n",
    );
    writeFileSync(
      join(exportDir, "comments.csv"),
      "id,permalink\ncm,https://www.reddit.com/r/a/comments/p/x/cm/\n",
    );

    const { logs } = await runImport({ types: "commented" }, [exportDir]);

    const output = JSON.parse(logs.join("\n"));
    expect(output.perOrigin.map((o: { origin: string }) => o.origin)).toEqual(["commented"]);
    expect(fetchCalls).toEqual([["t1_cm"]]);
  });

  test("--dry-run needs no auth, makes no network calls, and writes nothing", async () => {
    // Remove credentials entirely — dry run must not require them
    rmSync(join(tempDir, "reddit-cached"), { recursive: true, force: true });
    writeFileSync(
      join(exportDir, "saved_posts.csv"),
      "id,permalink\nxyz,https://www.reddit.com/r/a/comments/xyz/x/\n",
    );

    const { logs, exitCode } = await runImport({ "dry-run": true }, [exportDir]);

    expect(exitCode).toBeNull();
    const output = JSON.parse(logs.join("\n"));
    expect(output.perOrigin).toEqual([
      { origin: "saved", found: 1, alreadyPresent: 0, hydrated: 0, deletedStubs: 0 },
    ]);
    expect(fetchCalls).toEqual([]);

    const adapter = new SqliteAdapter(dbPath);
    try {
      expect(adapter.getPost("xyz")).toBeNull();
    } finally {
      adapter.close();
    }
  });
});
