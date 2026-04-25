import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { RedditApiClient, SqliteAdapter } from "@reddit-saved/core";
import { setOutputMode } from "../src/output";
import { ExitCaptured, captureConsole, captureExit, makeTempDb, restoreFetch } from "./helpers";

const originalEnv = { ...process.env };

const rateHeaders = {
  "x-ratelimit-remaining": "59",
  "x-ratelimit-reset": "60",
};

function makeRedditListingResponse(
  items: Array<{ id: string; kind?: string }>,
  after: string | null = null,
) {
  return {
    kind: "Listing",
    data: {
      children: items.map((item) => ({
        kind: item.kind ?? "t3",
        data: {
          id: item.id,
          name: `${item.kind ?? "t3"}_${item.id}`,
          title: `Post ${item.id}`,
          author: "testauthor",
          subreddit: "testsubreddit",
          permalink: `/r/testsubreddit/comments/${item.id}/test_post/`,
          created_utc: 1700000000,
          score: 42,
        },
      })),
      after,
    },
  };
}

describe("fetch command", () => {
  let dbPath: string;
  let tempDir: string;

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

    process.env.REDDIT_SAVED_CONFIG_DIR = configDir;
    process.env.XDG_DATA_HOME = tempDir;
    process.env.REDDIT_CLIENT_SECRET = "test-secret";
  });

  afterEach(() => {
    restoreFetch();
    setOutputMode(false, false, false);
    // Restore env
    for (const key of ["REDDIT_SAVED_CONFIG_DIR", "XDG_DATA_HOME", "REDDIT_CLIENT_SECRET"]) {
      if (originalEnv[key] !== undefined) {
        process.env[key] = originalEnv[key];
      } else {
        delete process.env[key];
      }
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("invalid --type exits with error", async () => {
    const { fetchCmd } = await import("../src/commands/fetch");
    const cap = captureConsole();
    const exit = captureExit();
    try {
      await fetchCmd({ db: dbPath, type: "invalid" }, []);
    } catch (e) {
      expect(e).toBeInstanceOf(ExitCaptured);
    } finally {
      exit.restore();
      cap.restore();
    }
    expect(exit.exitCode).toBe(1);
    expect(cap.errors[0]).toContain("Invalid --type");
  });

  test("fetches and stores items from Reddit API", async () => {
    // Mock fetch to return Reddit listing
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      // Token refresh — shouldn't be needed but handle gracefully
      if (url.includes("/api/v1/access_token")) {
        return Response.json(
          {
            access_token: "new-token",
            token_type: "bearer",
            expires_in: 3600,
            refresh_token: "new-refresh",
          },
          { headers: rateHeaders },
        );
      }

      // /api/v1/me — needed by API client for username
      if (url.includes("/api/v1/me")) {
        return Response.json({ name: "testuser" }, { headers: rateHeaders });
      }

      // Saved posts listing
      if (url.includes("/user/") && url.includes("/saved")) {
        return Response.json(makeRedditListingResponse([{ id: "post1" }, { id: "post2" }], null), {
          headers: rateHeaders,
        });
      }

      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const { fetchCmd } = await import("../src/commands/fetch");
    const cap = captureConsole();
    try {
      await fetchCmd({ db: dbPath }, []);
      const output = JSON.parse(cap.logs[0]);
      expect(output.fetched).toBe(2);
      expect(output.stored).toBe(2);
      expect(output.hasMore).toBe(false);
    } finally {
      cap.restore();
    }

    // Verify items actually in DB
    const adapter = new SqliteAdapter(dbPath);
    try {
      const stats = adapter.getStats();
      expect(stats.totalPosts).toBe(2);
    } finally {
      adapter.close();
    }
  });

  test("--full sets last_full_sync_time", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("/api/v1/me")) {
        return Response.json({ name: "testuser" }, { headers: rateHeaders });
      }
      if (url.includes("/user/") && url.includes("/saved")) {
        return Response.json(makeRedditListingResponse([{ id: "fullp1" }], null), {
          headers: rateHeaders,
        });
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const { fetchCmd } = await import("../src/commands/fetch");
    const cap = captureConsole();
    try {
      await fetchCmd({ db: dbPath, full: true }, []);
    } finally {
      cap.restore();
    }

    // Verify sync state
    const adapter = new SqliteAdapter(dbPath);
    try {
      const lastFull = adapter.getSyncState("last_full_sync_time");
      expect(lastFull).not.toBeNull();
      expect(Number(lastFull)).toBeGreaterThan(0);
    } finally {
      adapter.close();
    }
  });

  test("fetches multiple pages with cursor propagation", async () => {
    let pageNum = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("/api/v1/me")) {
        return Response.json({ name: "testuser" }, { headers: rateHeaders });
      }
      if (url.includes("/user/") && url.includes("/saved")) {
        pageNum++;
        if (pageNum === 1) {
          return Response.json(makeRedditListingResponse([{ id: "page1_p1" }], "cursor_abc"), {
            headers: rateHeaders,
          });
        }
        // Second page — verify cursor was passed
        expect(url).toContain("after=cursor_abc");
        return Response.json(makeRedditListingResponse([{ id: "page2_p1" }], null), {
          headers: rateHeaders,
        });
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const { fetchCmd } = await import("../src/commands/fetch");
    const cap = captureConsole();
    try {
      await fetchCmd({ db: dbPath }, []);
      const output = JSON.parse(cap.logs[0]);
      expect(output.fetched).toBe(2);
      expect(output.hasMore).toBe(false);
    } finally {
      cap.restore();
    }

    // Verify both pages stored
    const adapter = new SqliteAdapter(dbPath);
    try {
      const stats = adapter.getStats();
      expect(stats.totalPosts).toBe(2);
    } finally {
      adapter.close();
    }
  });

  test("reports hasMore when cursor is non-null at limit", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("/api/v1/me")) {
        return Response.json({ name: "testuser" }, { headers: rateHeaders });
      }
      if (url.includes("/user/") && url.includes("/saved")) {
        return Response.json(makeRedditListingResponse([{ id: "limited_p1" }], "more_cursor"), {
          headers: rateHeaders,
        });
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const { fetchCmd } = await import("../src/commands/fetch");
    const cap = captureConsole();
    try {
      await fetchCmd({ db: dbPath, limit: "1" }, []);
      const output = JSON.parse(cap.logs[0]);
      expect(output.fetched).toBe(1);
      expect(output.hasMore).toBe(true);
    } finally {
      cap.restore();
    }
  });

  test("handles API 403 error gracefully", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("/api/v1/me")) {
        return Response.json({ name: "testuser" }, { headers: rateHeaders });
      }
      if (url.includes("/user/") && url.includes("/saved")) {
        // 403 is non-retryable, so the client should fail fast
        return new Response("Forbidden", { status: 403, headers: rateHeaders });
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const { fetchCmd } = await import("../src/commands/fetch");
    const cap = captureConsole();
    try {
      await fetchCmd({ db: dbPath }, []);
      const output = JSON.parse(cap.logs[0]);
      expect(output.fetched).toBe(0);
      expect(output.stored).toBe(0);
      expect(output.errored).toBe(true);
      expect(cap.errors.some((e) => e.includes("Resume state was preserved"))).toBe(true);
    } finally {
      cap.restore();
    }

    const adapter = new SqliteAdapter(dbPath);
    try {
      expect(adapter.getSyncState("last_sync_time")).toBeNull();
    } finally {
      adapter.close();
    }

    expect(existsSync(join(dirname(dbPath), ".reddit-import-checkpoint.json"))).toBe(true);
  });

  test("resumes from checkpoint when one exists", async () => {
    // Seed a checkpoint file co-located with the DB (matches fetch.ts behavior with --db)
    const { SyncStateManager } = await import("@reddit-saved/core");
    const checkpointPath = join(dirname(dbPath), ".reddit-import-checkpoint.json");
    const stateManager = new SyncStateManager(checkpointPath);
    const checkpoint = stateManager.createNew();
    checkpoint.cursor = "resume_cursor_abc";
    checkpoint.totalFetched = 5;
    await stateManager.save(checkpoint);

    let receivedUrl = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("/api/v1/me")) {
        return Response.json({ name: "testuser" }, { headers: rateHeaders });
      }
      if (url.includes("/user/") && url.includes("/saved")) {
        receivedUrl = url;
        return Response.json(makeRedditListingResponse([{ id: "resumed_p1" }], null), {
          headers: rateHeaders,
        });
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const { fetchCmd } = await import("../src/commands/fetch");
    const cap = captureConsole();
    try {
      await fetchCmd({ db: dbPath }, []);
      // Verify the cursor was passed to the API
      expect(receivedUrl).toContain("after=resume_cursor_abc");
      // Verify resume message was printed
      expect(cap.errors.some((e) => e.includes("Resuming"))).toBe(true);
    } finally {
      cap.restore();
    }
  });

  test("resumes from stored incremental cursor when no checkpoint exists", async () => {
    const adapter = new SqliteAdapter(dbPath);
    adapter.setSyncState("last_cursor_saved", "stored_cursor_123");
    adapter.close();

    let receivedUrl = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("/api/v1/me")) {
        return Response.json({ name: "testuser" }, { headers: rateHeaders });
      }
      if (url.includes("/user/") && url.includes("/saved")) {
        receivedUrl = url;
        return Response.json(makeRedditListingResponse([{ id: "stored_resume_p1" }], null), {
          headers: rateHeaders,
        });
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const { fetchCmd } = await import("../src/commands/fetch");
    const cap = captureConsole();
    try {
      await fetchCmd({ db: dbPath }, []);
      expect(receivedUrl).toContain("after=stored_cursor_123");
      expect(
        cap.errors.some((e) =>
          e.includes("Resuming incremental saved fetch from the last stored cursor."),
        ),
      ).toBe(true);
    } finally {
      cap.restore();
    }
  });

  test("checkpoint cursor takes precedence over stored incremental cursor", async () => {
    const adapter = new SqliteAdapter(dbPath);
    adapter.setSyncState("last_cursor_saved", "stored_cursor_123");
    adapter.close();

    const { SyncStateManager } = await import("@reddit-saved/core");
    const checkpointPath = join(dirname(dbPath), ".reddit-import-checkpoint.json");
    const stateManager = new SyncStateManager(checkpointPath);
    const checkpoint = stateManager.createNew();
    checkpoint.cursor = "checkpoint_cursor_999";
    checkpoint.totalFetched = 7;
    await stateManager.save(checkpoint);

    let receivedUrl = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("/api/v1/me")) {
        return Response.json({ name: "testuser" }, { headers: rateHeaders });
      }
      if (url.includes("/user/") && url.includes("/saved")) {
        receivedUrl = url;
        return Response.json(makeRedditListingResponse([{ id: "checkpoint_resume_p1" }], null), {
          headers: rateHeaders,
        });
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const { fetchCmd } = await import("../src/commands/fetch");
    const cap = captureConsole();
    try {
      await fetchCmd({ db: dbPath }, []);
      expect(receivedUrl).toContain("after=checkpoint_cursor_999");
      expect(receivedUrl).not.toContain("stored_cursor_123");
      expect(cap.errors.some((e) => e.includes("Found checkpoint"))).toBe(true);
    } finally {
      cap.restore();
    }
  });

  test("scoped incremental cursor is used and cleared on successful completion", async () => {
    const adapter = new SqliteAdapter(dbPath);
    adapter.setSyncState("last_cursor_saved", "saved_cursor_111");
    adapter.close();

    let receivedUrl = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("/api/v1/me")) {
        return Response.json({ name: "testuser" }, { headers: rateHeaders });
      }
      if (url.includes("/user/") && url.includes("/saved")) {
        receivedUrl = url;
        return Response.json(makeRedditListingResponse([{ id: "scoped_resume_saved1" }], null), {
          headers: rateHeaders,
        });
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const { fetchCmd } = await import("../src/commands/fetch");
    const cap = captureConsole();
    try {
      await fetchCmd({ db: dbPath }, []);
      expect(receivedUrl).toContain("after=saved_cursor_111");
    } finally {
      cap.restore();
    }

    const verifyAdapter = new SqliteAdapter(dbPath);
    try {
      expect(verifyAdapter.getSyncState("last_cursor_saved")).toBeNull();
    } finally {
      verifyAdapter.close();
    }
  });

  test("ignores checkpoint from a different origin", async () => {
    const { SyncStateManager } = await import("@reddit-saved/core");
    const checkpointPath = join(dirname(dbPath), ".reddit-import-checkpoint.json");
    const stateManager = new SyncStateManager(checkpointPath);
    const checkpoint = stateManager.createNew(undefined, {
      contentOrigin: "upvoted",
      isFull: false,
    });
    checkpoint.cursor = "upvoted_cursor_999";
    checkpoint.totalFetched = 7;
    await stateManager.save(checkpoint);

    let receivedUrl = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("/api/v1/me")) {
        return Response.json({ name: "testuser" }, { headers: rateHeaders });
      }
      if (url.includes("/user/") && url.includes("/saved")) {
        receivedUrl = url;
        return Response.json(makeRedditListingResponse([{ id: "saved_from_start" }], null), {
          headers: rateHeaders,
        });
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const { fetchCmd } = await import("../src/commands/fetch");
    const cap = captureConsole();
    try {
      await fetchCmd({ db: dbPath }, []);
      expect(receivedUrl).not.toContain("after=upvoted_cursor_999");
      expect(cap.errors.some((e) => e.includes("Ignoring checkpoint"))).toBe(true);
    } finally {
      cap.restore();
    }
  });

  test("ignores incremental checkpoint during full fetch", async () => {
    const { SyncStateManager } = await import("@reddit-saved/core");
    const checkpointPath = join(dirname(dbPath), ".reddit-import-checkpoint.json");
    const stateManager = new SyncStateManager(checkpointPath);
    const checkpoint = stateManager.createNew(undefined, { contentOrigin: "saved", isFull: false });
    checkpoint.cursor = "incremental_cursor_999";
    await stateManager.save(checkpoint);

    let receivedUrl = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("/api/v1/me")) {
        return Response.json({ name: "testuser" }, { headers: rateHeaders });
      }
      if (url.includes("/user/") && url.includes("/saved")) {
        receivedUrl = url;
        return Response.json(makeRedditListingResponse([{ id: "full_fetch_start" }], null), {
          headers: rateHeaders,
        });
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const { fetchCmd } = await import("../src/commands/fetch");
    const cap = captureConsole();
    try {
      await fetchCmd({ db: dbPath, full: true }, []);
      expect(receivedUrl).not.toContain("after=incremental_cursor_999");
      expect(cap.errors.some((e) => e.includes("Ignoring checkpoint"))).toBe(true);
    } finally {
      cap.restore();
    }
  });

  test("fetches upvoted content with --type upvoted", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("/api/v1/me")) {
        return Response.json({ name: "testuser" }, { headers: rateHeaders });
      }
      if (url.includes("/user/") && url.includes("/upvoted")) {
        return Response.json(makeRedditListingResponse([{ id: "up1" }], null), {
          headers: rateHeaders,
        });
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const { fetchCmd } = await import("../src/commands/fetch");
    const cap = captureConsole();
    try {
      await fetchCmd({ db: dbPath, type: "upvoted" }, []);
      const output = JSON.parse(cap.logs[0]);
      expect(output.fetched).toBe(1);
      expect(output.type).toBe("upvoted");
    } finally {
      cap.restore();
    }
  });

  test("fetches submitted content with --type submitted", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("/api/v1/me")) {
        return Response.json({ name: "testuser" }, { headers: rateHeaders });
      }
      if (url.includes("/user/") && url.includes("/submitted")) {
        return Response.json(makeRedditListingResponse([{ id: "sub1" }], null), {
          headers: rateHeaders,
        });
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const { fetchCmd } = await import("../src/commands/fetch");
    const cap = captureConsole();
    try {
      await fetchCmd({ db: dbPath, type: "submitted" }, []);
      const output = JSON.parse(cap.logs[0]);
      expect(output.fetched).toBe(1);
      expect(output.type).toBe("submitted");
    } finally {
      cap.restore();
    }
  });

  test("fetches comments with --type comments", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("/api/v1/me")) {
        return Response.json({ name: "testuser" }, { headers: rateHeaders });
      }
      if (url.includes("/user/") && url.includes("/comments")) {
        return Response.json(makeRedditListingResponse([{ id: "com1", kind: "t1" }], null), {
          headers: rateHeaders,
        });
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const { fetchCmd } = await import("../src/commands/fetch");
    const cap = captureConsole();
    try {
      await fetchCmd({ db: dbPath, type: "comments" }, []);
      const output = JSON.parse(cap.logs[0]);
      expect(output.fetched).toBe(1);
      expect(output.type).toBe("comments");
    } finally {
      cap.restore();
    }
  });

  test("stores incremental cursor per content origin", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("/api/v1/me")) {
        return Response.json({ name: "testuser" }, { headers: rateHeaders });
      }
      if (url.includes("/user/") && url.includes("/upvoted")) {
        return Response.json(
          makeRedditListingResponse([{ id: "up_cursor_p1" }], "up_next_cursor"),
          {
            headers: rateHeaders,
          },
        );
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const { fetchCmd } = await import("../src/commands/fetch");
    const cap = captureConsole();
    try {
      await fetchCmd({ db: dbPath, type: "upvoted", limit: "1" }, []);
      const output = JSON.parse(cap.logs[0]);
      expect(output.hasMore).toBe(true);
    } finally {
      cap.restore();
    }

    const adapter = new SqliteAdapter(dbPath);
    try {
      expect(adapter.getSyncState("last_cursor_upvoted")).toBe("up_next_cursor");
      expect(adapter.getSyncState("last_cursor_saved")).toBeNull();
    } finally {
      adapter.close();
    }
  });

  test("stored incremental cursors are scoped by origin", async () => {
    const adapter = new SqliteAdapter(dbPath);
    adapter.setSyncState("last_cursor_saved", "saved_cursor_111");
    adapter.setSyncState("last_cursor_upvoted", "upvoted_cursor_222");
    adapter.close();

    let receivedUrl = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("/api/v1/me")) {
        return Response.json({ name: "testuser" }, { headers: rateHeaders });
      }
      if (url.includes("/user/") && url.includes("/upvoted")) {
        receivedUrl = url;
        return Response.json(makeRedditListingResponse([{ id: "up_scoped_p1" }], null), {
          headers: rateHeaders,
        });
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const { fetchCmd } = await import("../src/commands/fetch");
    const cap = captureConsole();
    try {
      await fetchCmd({ db: dbPath, type: "upvoted" }, []);
      expect(receivedUrl).toContain("after=upvoted_cursor_222");
      expect(receivedUrl).not.toContain("saved_cursor_111");
    } finally {
      cap.restore();
    }

    const verifyAdapter = new SqliteAdapter(dbPath);
    try {
      expect(verifyAdapter.getSyncState("last_cursor_upvoted")).toBeNull();
      expect(verifyAdapter.getSyncState("last_cursor_saved")).toBe("saved_cursor_111");
    } finally {
      verifyAdapter.close();
    }
  });

  test("--full reports orphaned count in output", async () => {
    // Pre-seed DB with an item that won't appear in the fetch response
    const adapter = new SqliteAdapter(dbPath);
    adapter.upsertPosts(
      [
        {
          kind: "t3",
          data: {
            id: "old_orphan",
            name: "t3_old_orphan",
            title: "Old post",
            author: "olduser",
            subreddit: "test",
            permalink: "/r/test/comments/old_orphan/old/",
            created_utc: 1600000000,
            score: 10,
          },
        },
      ],
      "saved",
    );
    // Backdate last_seen_at so orphan detection picks it up
    adapter.getDb().run("UPDATE posts SET last_seen_at = ? WHERE id = ?", [1, "old_orphan"]);
    adapter.close();

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("/api/v1/me")) {
        return Response.json({ name: "testuser" }, { headers: rateHeaders });
      }
      if (url.includes("/user/") && url.includes("/saved")) {
        return Response.json(makeRedditListingResponse([{ id: "fresh1" }], null), {
          headers: rateHeaders,
        });
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const { fetchCmd } = await import("../src/commands/fetch");
    const cap = captureConsole();
    try {
      await fetchCmd({ db: dbPath, full: true }, []);
      const output = JSON.parse(cap.logs[0]);
      expect(output.orphaned).toBeDefined();
      expect(output.orphaned).toBeGreaterThanOrEqual(1);
    } finally {
      cap.restore();
    }
  });

  test("--full ignores stored incremental cursor and clears it on success", async () => {
    const adapter = new SqliteAdapter(dbPath);
    adapter.setSyncState("last_cursor_saved", "stored_cursor_123");
    adapter.close();

    let receivedUrl = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("/api/v1/me")) {
        return Response.json({ name: "testuser" }, { headers: rateHeaders });
      }
      if (url.includes("/user/") && url.includes("/saved")) {
        receivedUrl = url;
        return Response.json(makeRedditListingResponse([{ id: "full_ignore_cursor" }], null), {
          headers: rateHeaders,
        });
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const { fetchCmd } = await import("../src/commands/fetch");
    const cap = captureConsole();
    try {
      await fetchCmd({ db: dbPath, full: true }, []);
      expect(receivedUrl).not.toContain("after=stored_cursor_123");
    } finally {
      cap.restore();
    }

    const verifyAdapter = new SqliteAdapter(dbPath);
    try {
      expect(verifyAdapter.getSyncState("last_cursor_saved")).toBeNull();
    } finally {
      verifyAdapter.close();
    }
  });

  test("human mode shows Fetch Complete section", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("/api/v1/me")) {
        return Response.json({ name: "testuser" }, { headers: rateHeaders });
      }
      if (url.includes("/user/") && url.includes("/saved")) {
        return Response.json(makeRedditListingResponse([{ id: "hm1" }], null), {
          headers: rateHeaders,
        });
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    setOutputMode(true, false, false);
    const { fetchCmd } = await import("../src/commands/fetch");
    const cap = captureConsole();
    try {
      await fetchCmd({ db: dbPath }, []);
      const allOutput = cap.logs.join("\n");
      expect(allOutput).toContain("Fetch Complete");
      expect(allOutput).toContain("Fetched");
      expect(allOutput).toContain("Stored");
    } finally {
      cap.restore();
      setOutputMode(false, false, false);
    }
  });

  test("clears stored incremental cursor once the listing is exhausted", async () => {
    const adapter = new SqliteAdapter(dbPath);
    adapter.setSyncState("last_cursor_saved", "stored_cursor_123");
    adapter.close();

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("/api/v1/me")) {
        return Response.json({ name: "testuser" }, { headers: rateHeaders });
      }
      if (url.includes("/user/") && url.includes("/saved")) {
        return Response.json(makeRedditListingResponse([{ id: "clear_cursor_p1" }], null), {
          headers: rateHeaders,
        });
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const { fetchCmd } = await import("../src/commands/fetch");
    const cap = captureConsole();
    try {
      await fetchCmd({ db: dbPath }, []);
    } finally {
      cap.restore();
    }

    const verifyAdapter = new SqliteAdapter(dbPath);
    try {
      expect(verifyAdapter.getSyncState("last_cursor_saved")).toBeNull();
    } finally {
      verifyAdapter.close();
    }
  });

  test("preserves checkpoint and cursor when pagination fails after partial progress", async () => {
    const originalFetchSaved = RedditApiClient.prototype.fetchSaved;
    RedditApiClient.prototype.fetchSaved = async () => ({
      items: makeRedditListingResponse([{ id: "page1_ok" }], "resume_after_page1").data.children,
      cursor: "resume_after_page1",
      hasMore: false,
      wasCancelled: false,
      wasErrored: true,
    });

    const { fetchCmd } = await import("../src/commands/fetch");
    const cap = captureConsole();
    try {
      await fetchCmd({ db: dbPath }, []);
      const output = JSON.parse(cap.logs[0]);
      expect(output.fetched).toBe(1);
      expect(output.stored).toBe(1);
      expect(output.errored).toBe(true);
    } finally {
      RedditApiClient.prototype.fetchSaved = originalFetchSaved;
      cap.restore();
    }

    const adapter = new SqliteAdapter(dbPath);
    try {
      expect(adapter.getSyncState("last_sync_time")).toBeNull();
      expect(adapter.getSyncState("last_cursor_saved")).toBe("resume_after_page1");
    } finally {
      adapter.close();
    }

    const { SyncStateManager } = await import("@reddit-saved/core");
    const checkpointPath = join(dirname(dbPath), ".reddit-import-checkpoint.json");
    const stateManager = new SyncStateManager(checkpointPath);
    const checkpoint = await stateManager.load();
    expect(checkpoint?.cursor).toBe("resume_after_page1");
    expect(checkpoint?.totalFetched).toBe(1);
  });

  test("preserves checkpoint when upsertPosts fails", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("/api/v1/me")) {
        return Response.json({ name: "testuser" }, { headers: rateHeaders });
      }
      if (url.includes("/user/") && url.includes("/saved")) {
        return Response.json(makeRedditListingResponse([{ id: "fail_p1" }], null), {
          headers: rateHeaders,
        });
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    // Pre-create checkpoint so we can verify it survives an error
    const checkpointPath = join(dirname(dbPath), ".reddit-import-checkpoint.json");
    const { SyncStateManager } = await import("@reddit-saved/core");
    const sm = new SyncStateManager(checkpointPath);
    const cp = sm.createNew();
    cp.phase = "fetching";
    cp.totalFetched = 0;
    await sm.save(cp);
    expect(existsSync(checkpointPath)).toBe(true);

    // Monkey-patch SqliteAdapter.prototype.upsertPosts to throw
    const origUpsert = SqliteAdapter.prototype.upsertPosts;
    SqliteAdapter.prototype.upsertPosts = () => {
      throw new Error("Simulated DB write failure");
    };

    const { fetchCmd } = await import("../src/commands/fetch");
    const cap = captureConsole();
    let threw = false;
    try {
      await fetchCmd({ db: dbPath }, []);
    } catch {
      threw = true;
    } finally {
      cap.restore();
      SqliteAdapter.prototype.upsertPosts = origUpsert;
    }
    expect(threw).toBe(true);

    // Checkpoint should have been preserved (not cleared) since upsert failed before clear()
    expect(existsSync(checkpointPath)).toBe(true);
  });

  test("does not advance checkpoint cursor until storage succeeds", async () => {
    const checkpointPath = join(dirname(dbPath), ".reddit-import-checkpoint.json");
    const { SyncStateManager } = await import("@reddit-saved/core");
    const stateManager = new SyncStateManager(checkpointPath);
    const checkpoint = stateManager.createNew();
    checkpoint.cursor = "resume_cursor_abc";
    checkpoint.totalFetched = 5;
    await stateManager.save(checkpoint);

    const receivedUrls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("/api/v1/me")) {
        return Response.json({ name: "testuser" }, { headers: rateHeaders });
      }
      if (url.includes("/user/") && url.includes("/saved")) {
        receivedUrls.push(url);
        return Response.json(makeRedditListingResponse([{ id: "resume_me" }], null), {
          headers: rateHeaders,
        });
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const origUpsert = SqliteAdapter.prototype.upsertPosts;
    SqliteAdapter.prototype.upsertPosts = () => {
      throw new Error("Simulated DB write failure");
    };

    const { fetchCmd } = await import("../src/commands/fetch");
    const failedCap = captureConsole();
    await expect(fetchCmd({ db: dbPath }, [])).rejects.toThrow("Simulated DB write failure");
    failedCap.restore();
    SqliteAdapter.prototype.upsertPosts = origUpsert;

    const savedCheckpoint = await stateManager.load();
    expect(savedCheckpoint?.cursor).toBe("resume_cursor_abc");
    expect(savedCheckpoint?.totalFetched).toBe(5);

    const successCap = captureConsole();
    try {
      await fetchCmd({ db: dbPath }, []);
      const output = JSON.parse(successCap.logs[0]);
      expect(output.fetched).toBe(1);
    } finally {
      successCap.restore();
    }

    expect(receivedUrls).toHaveLength(2);
    expect(receivedUrls[0]).toContain("after=resume_cursor_abc");
    expect(receivedUrls[1]).toContain("after=resume_cursor_abc");
    expect(existsSync(checkpointPath)).toBe(false);
  });
});
