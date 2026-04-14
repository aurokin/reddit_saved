import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { SqliteAdapter } from "@reddit-saved/core";
import { setOutputMode } from "../src/output";
import {
  ExitCaptured,
  captureConsole,
  captureExit,
  makeItem,
  makeTempDb,
  restoreFetch,
} from "./helpers";

describe("unsave command", () => {
  let dbPath: string;
  let adapter: SqliteAdapter;

  beforeEach(() => {
    dbPath = makeTempDb();
    adapter = new SqliteAdapter(dbPath);
    setOutputMode(false, false, false);
  });

  afterEach(() => {
    adapter.close();
    rmSync(dirname(dbPath), { recursive: true, force: true });
  });

  test("exits with error when neither --confirm nor --dry-run", async () => {
    adapter.close();

    const { unsaveCmd } = await import("../src/commands/unsave");
    const cap = captureConsole();
    const exit = captureExit();
    try {
      await unsaveCmd({ db: dbPath, id: "abc123" }, []);
    } catch (e) {
      expect(e).toBeInstanceOf(ExitCaptured);
    } finally {
      exit.restore();
      cap.restore();
    }
    expect(exit.exitCode).toBe(1);
    expect(cap.errors[0]).toContain("destructive");
    expect(cap.errors[0]).toContain("--confirm");
  });

  test("exits with error when no IDs and no filters", async () => {
    adapter.close();

    const { unsaveCmd } = await import("../src/commands/unsave");
    const cap = captureConsole();
    const exit = captureExit();
    try {
      await unsaveCmd({ db: dbPath, "dry-run": true }, []);
    } catch (e) {
      expect(e).toBeInstanceOf(ExitCaptured);
    } finally {
      exit.restore();
      cap.restore();
    }
    expect(exit.exitCode).toBe(1);
    expect(cap.errors[0]).toContain("--id");
  });

  test("--dry-run shows items without calling API", async () => {
    adapter.upsertPosts(
      [
        makeItem({ id: "p1", title: "Post to unsave", subreddit: "test" }),
        makeItem({ id: "p2", title: "Another post", subreddit: "test" }),
      ],
      "saved",
    );
    adapter.close();

    const { unsaveCmd } = await import("../src/commands/unsave");
    const cap = captureConsole();
    try {
      await unsaveCmd({ db: dbPath, "dry-run": true, id: "p1,p2" }, []);
      const output = JSON.parse(cap.logs[0]);
      expect(output.dryRun).toBe(true);
      expect(output.count).toBe(2);
      expect(output.ids).toContain("p1");
      expect(output.ids).toContain("p2");
    } finally {
      cap.restore();
    }
  });

  test("exits with error when IDs not found in DB", async () => {
    adapter.close();

    const { unsaveCmd } = await import("../src/commands/unsave");
    const cap = captureConsole();
    const exit = captureExit();
    try {
      await unsaveCmd({ db: dbPath, "dry-run": true, id: "nonexistent" }, []);
    } catch (e) {
      expect(e).toBeInstanceOf(ExitCaptured);
    } finally {
      exit.restore();
      cap.restore();
    }
    expect(exit.exitCode).toBe(1);
    expect(cap.errors.some((e) => e.includes("None of the specified IDs"))).toBe(true);
  });

  test("--dry-run with filter shows matching items", async () => {
    adapter.upsertPosts(
      [
        makeItem({ id: "p1", title: "Rust post", subreddit: "rust" }),
        makeItem({ id: "p2", title: "Python post", subreddit: "python" }),
      ],
      "saved",
    );
    adapter.close();

    const { unsaveCmd } = await import("../src/commands/unsave");
    const cap = captureConsole();
    try {
      await unsaveCmd({ db: dbPath, "dry-run": true, subreddit: "rust" }, []);
      const output = JSON.parse(cap.logs[0]);
      expect(output.dryRun).toBe(true);
      expect(output.count).toBe(1);
      expect(output.ids).toContain("p1");
    } finally {
      cap.restore();
    }
  });

  test("--dry-run with no matching filter prints info", async () => {
    adapter.upsertPosts([makeItem({ id: "p1", subreddit: "rust" })], "saved");
    adapter.close();

    const { unsaveCmd } = await import("../src/commands/unsave");
    const cap = captureConsole();
    try {
      await unsaveCmd({ db: dbPath, "dry-run": true, subreddit: "nonexistent" }, []);
      // Should output { unsaved: 0 } or print info
      expect(cap.errors.some((e) => e.includes("No items")) || cap.logs.length > 0).toBe(true);
    } finally {
      cap.restore();
    }
  });

  test("--dry-run with mix of valid and invalid IDs warns about unknown", async () => {
    adapter.upsertPosts([makeItem({ id: "p1", title: "Valid post" })], "saved");
    adapter.close();

    const { unsaveCmd } = await import("../src/commands/unsave");
    const cap = captureConsole();
    try {
      await unsaveCmd({ db: dbPath, "dry-run": true, id: "p1,nonexistent" }, []);
      // Should warn about the unknown ID
      expect(cap.errors.some((e) => e.includes("nonexistent"))).toBe(true);
      // Should still show the valid item in dry-run output
      const output = JSON.parse(cap.logs[0]);
      expect(output.dryRun).toBe(true);
      expect(output.count).toBe(1);
      expect(output.ids).toContain("p1");
    } finally {
      cap.restore();
    }
  });

  test("rejects mixing --id selectors with filter selectors", async () => {
    adapter.upsertPosts([makeItem({ id: "p1", subreddit: "rust" })], "saved");
    adapter.close();

    const { unsaveCmd } = await import("../src/commands/unsave");
    const cap = captureConsole();
    const exit = captureExit();
    try {
      await unsaveCmd({ db: dbPath, "dry-run": true, id: "p1", subreddit: "rust" }, []);
    } catch (e) {
      expect(e).toBeInstanceOf(ExitCaptured);
    } finally {
      exit.restore();
      cap.restore();
    }

    expect(exit.exitCode).toBe(1);
    expect(cap.errors.some((e) => e.includes("either --id selectors or filter selectors"))).toBe(
      true,
    );
  });

  test("rejects non-positive --limit for filter-based unsave", async () => {
    adapter.upsertPosts([makeItem({ id: "p1", subreddit: "rust" })], "saved");
    adapter.close();

    const { unsaveCmd } = await import("../src/commands/unsave");
    const cap = captureConsole();
    const exit = captureExit();
    try {
      await unsaveCmd({ db: dbPath, "dry-run": true, subreddit: "rust", limit: "-1" }, []);
    } catch (e) {
      expect(e).toBeInstanceOf(ExitCaptured);
    } finally {
      exit.restore();
      cap.restore();
    }

    expect(exit.exitCode).toBe(1);
    expect(cap.errors.some((e) => e.includes("--limit must be a positive integer"))).toBe(true);
  });

  test("--dry-run supports additional IDs as positionals after --id", async () => {
    adapter.upsertPosts(
      [
        makeItem({ id: "p1", title: "Post 1", subreddit: "test" }),
        makeItem({ id: "p2", title: "Post 2", subreddit: "test" }),
        makeItem({ id: "p3", title: "Post 3", subreddit: "test" }),
      ],
      "saved",
    );
    adapter.close();

    const { unsaveCmd } = await import("../src/commands/unsave");
    const cap = captureConsole();
    try {
      await unsaveCmd({ db: dbPath, "dry-run": true, id: "p1,p2" }, ["p3"]);
      const output = JSON.parse(cap.logs[0]);
      expect(output.dryRun).toBe(true);
      expect(output.count).toBe(3);
      expect(output.ids).toEqual(["p1", "p2", "p3"]);
    } finally {
      cap.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// unsave --confirm (actual API path)
// ---------------------------------------------------------------------------

describe("unsave command — API path", () => {
  let dbPath: string;
  let tempDir: string;
  const originalEnv = { ...process.env };

  const rateHeaders = {
    "x-ratelimit-remaining": "59",
    "x-ratelimit-reset": "60",
  };

  beforeEach(() => {
    dbPath = makeTempDb();
    tempDir = dirname(dbPath);
    setOutputMode(false, false, false);

    // Set up fake config dir with auth.json
    const configDir = join(tempDir, "reddit-saved");
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

    process.env.XDG_CONFIG_HOME = tempDir;
    process.env.XDG_DATA_HOME = tempDir;
    process.env.REDDIT_CLIENT_SECRET = "test-secret";
  });

  afterEach(() => {
    restoreFetch();
    setOutputMode(false, false, false);
    for (const key of ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "REDDIT_CLIENT_SECRET"]) {
      if (originalEnv[key] !== undefined) {
        process.env[key] = originalEnv[key];
      } else {
        delete process.env[key];
      }
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("--confirm unsaves items via API and marks in DB", async () => {
    // Seed DB
    const adapter = new SqliteAdapter(dbPath);
    adapter.upsertPosts(
      [makeItem({ id: "p1", title: "Post 1" }), makeItem({ id: "p2", title: "Post 2" })],
      "saved",
    );
    adapter.close();

    // Track unsave API calls
    const unsavedFullnames: string[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("/api/v1/me")) {
        return Response.json({ name: "testuser" }, { headers: rateHeaders });
      }
      if (url.includes("/api/unsave")) {
        const body = init?.body ? new URLSearchParams(init.body as string) : null;
        const id = body?.get("id");
        if (id) unsavedFullnames.push(id);
        return new Response("{}", { status: 200, headers: rateHeaders });
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const { unsaveCmd } = await import("../src/commands/unsave");
    const cap = captureConsole();
    try {
      await unsaveCmd({ db: dbPath, confirm: true, id: "p1,p2" }, []);
      const output = JSON.parse(cap.logs[0]);
      expect(output.unsaved).toBe(2);
      expect(output.failed).toBe(0);
    } finally {
      cap.restore();
    }

    // Verify API was called with correct fullnames
    expect(unsavedFullnames).toContain("t3_p1");
    expect(unsavedFullnames).toContain("t3_p2");

    // Verify DB was updated
    const verifyAdapter = new SqliteAdapter(dbPath);
    try {
      const p1 = verifyAdapter.getPost("p1");
      const p2 = verifyAdapter.getPost("p2");
      expect(p1?.is_on_reddit).toBe(0);
      expect(p2?.is_on_reddit).toBe(0);
    } finally {
      verifyAdapter.close();
    }
  });

  test("--confirm with partial API failure reports counts", async () => {
    const adapter = new SqliteAdapter(dbPath);
    adapter.upsertPosts(
      [makeItem({ id: "p1", title: "Will succeed" }), makeItem({ id: "p2", title: "Will fail" })],
      "saved",
    );
    adapter.close();

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("/api/v1/me")) {
        return Response.json({ name: "testuser" }, { headers: rateHeaders });
      }
      if (url.includes("/api/unsave")) {
        const body = init?.body ? new URLSearchParams(init.body as string) : null;
        const id = body?.get("id");
        if (id === "t3_p2") {
          // 403 is non-retryable — fails immediately
          return new Response("Forbidden", { status: 403, headers: rateHeaders });
        }
        return new Response("{}", { status: 200, headers: rateHeaders });
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const { unsaveCmd } = await import("../src/commands/unsave");
    const cap = captureConsole();
    try {
      await unsaveCmd({ db: dbPath, confirm: true, id: "p1,p2" }, []);
      const output = JSON.parse(cap.logs[0]);
      expect(output.unsaved).toBe(1);
      expect(output.failed).toBe(1);
    } finally {
      cap.restore();
    }
  });

  test("--confirm with filter-based ID resolution calls API for matching posts", async () => {
    const adapter = new SqliteAdapter(dbPath);
    adapter.upsertPosts(
      [
        makeItem({ id: "r1", title: "Rust post", subreddit: "rust" }),
        makeItem({ id: "py1", title: "Python post", subreddit: "python" }),
      ],
      "saved",
    );
    adapter.close();

    const unsavedFullnames: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("/api/v1/me")) {
        return Response.json({ name: "testuser" }, { headers: rateHeaders });
      }
      if (url.includes("/api/unsave")) {
        const body = init?.body ? new URLSearchParams(init.body as string) : null;
        const id = body?.get("id");
        if (id) unsavedFullnames.push(id);
        return new Response("{}", { status: 200, headers: rateHeaders });
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const { unsaveCmd } = await import("../src/commands/unsave");
    const cap = captureConsole();
    try {
      await unsaveCmd({ db: dbPath, confirm: true, subreddit: "rust" }, []);
      const output = JSON.parse(cap.logs[0]);
      expect(output.unsaved).toBe(1);
      expect(output.failed).toBe(0);
    } finally {
      cap.restore();
    }

    // Only the rust post should have been unsaved
    expect(unsavedFullnames).toContain("t3_r1");
    expect(unsavedFullnames).not.toContain("t3_py1");

    // Verify the rust post is marked unsaved in DB
    const verifyAdapter = new SqliteAdapter(dbPath);
    try {
      expect(verifyAdapter.getPost("r1")?.is_on_reddit).toBe(0);
      expect(verifyAdapter.getPost("py1")?.is_on_reddit).toBe(1);
    } finally {
      verifyAdapter.close();
    }
  });

  test("--confirm handles malformed fullname gracefully", async () => {
    const adapter = new SqliteAdapter(dbPath);
    adapter.upsertPosts([makeItem({ id: "p1", title: "Post 1" })], "saved");
    // Inject a malformed name (no underscore) to trigger the warning path
    adapter.getDb().run("UPDATE posts SET name = ? WHERE id = ?", ["malformed", "p1"]);
    adapter.close();

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("/api/v1/me")) {
        return Response.json({ name: "testuser" }, { headers: rateHeaders });
      }
      if (url.includes("/api/unsave")) {
        return new Response("{}", { status: 200, headers: rateHeaders });
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const { unsaveCmd } = await import("../src/commands/unsave");
    const cap = captureConsole();
    try {
      await unsaveCmd({ db: dbPath, confirm: true, id: "p1" }, []);
      const output = JSON.parse(cap.logs[0]);
      // The unsave API succeeded but the fullname couldn't be parsed to mark locally
      expect(output.unsaved).toBe(1);
      // Warning about malformed fullname should have been emitted
      expect(cap.errors.some((e) => e.includes("malformed"))).toBe(true);
    } finally {
      cap.restore();
    }

    // Verify post is NOT marked unsaved locally (fullname couldn't be parsed)
    const verifyAdapter = new SqliteAdapter(dbPath);
    try {
      expect(verifyAdapter.getPost("p1")?.is_on_reddit).toBe(1);
    } finally {
      verifyAdapter.close();
    }
  });

  test("--confirm in human mode shows unsaved count", async () => {
    const adapter = new SqliteAdapter(dbPath);
    adapter.upsertPosts([makeItem({ id: "p1", title: "Post 1" })], "saved");
    adapter.close();

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("/api/v1/me")) {
        return Response.json({ name: "testuser" }, { headers: rateHeaders });
      }
      if (url.includes("/api/unsave")) {
        return new Response("{}", { status: 200, headers: rateHeaders });
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    setOutputMode(true, false, false);
    const { unsaveCmd } = await import("../src/commands/unsave");
    const cap = captureConsole();
    try {
      await unsaveCmd({ db: dbPath, confirm: true, id: "p1" }, []);
      expect(cap.errors.some((e) => e.includes("Unsaved 1 item(s)"))).toBe(true);
    } finally {
      cap.restore();
      setOutputMode(false, false, false);
    }
  });
});

// ---------------------------------------------------------------------------
// unsave — human mode output
// ---------------------------------------------------------------------------

describe("unsave command — human mode", () => {
  let dbPath: string;
  let adapter: SqliteAdapter;

  beforeEach(() => {
    dbPath = makeTempDb();
    adapter = new SqliteAdapter(dbPath);
    setOutputMode(true, false, false);
  });

  afterEach(() => {
    adapter.close();
    setOutputMode(false, false, false);
    rmSync(dirname(dbPath), { recursive: true, force: true });
  });

  test("--dry-run in human mode shows table with Would unsave", async () => {
    adapter.upsertPosts(
      [makeItem({ id: "p1", title: "Post to unsave", subreddit: "test" })],
      "saved",
    );
    adapter.close();

    const { unsaveCmd } = await import("../src/commands/unsave");
    const cap = captureConsole();
    try {
      await unsaveCmd({ db: dbPath, "dry-run": true, id: "p1" }, []);
      const allOutput = cap.logs.join("\n");
      expect(allOutput).toContain("Would unsave");
      expect(allOutput).toContain("p1");
    } finally {
      cap.restore();
    }
  });
});
