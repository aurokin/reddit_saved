import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type FetchResult,
  RedditApiClient,
  SqliteAdapter,
  acquireJobLock,
  getJobLockPathForDatabase,
} from "@reddit-cached/core";
import { parseJobSteps } from "../src/commands/jobs";
import { setOutputMode } from "../src/output";
import { captureConsole, makeTempDb, restoreFetch } from "./helpers";

const originalEnv = { ...process.env };

function emptyFetchResult(): FetchResult {
  return {
    items: [],
    cursor: null,
    hasMore: false,
    totalFetched: 0,
    wasErrored: false,
    wasCancelled: false,
  } as unknown as FetchResult;
}

describe("parseJobSteps", () => {
  test("defaults to the full pipeline", () => {
    expect(parseJobSteps(undefined)).toEqual(["fetch", "context", "inbox", "backup"]);
  });

  test("selects a subset in canonical order", () => {
    expect(parseJobSteps("inbox,fetch")).toEqual(["fetch", "inbox"]);
  });

  test("rejects unknown steps", () => {
    expect(() => parseJobSteps("fetch,bogus")).toThrow(/Unknown job step "bogus"/);
  });
});

describe("jobs run command", () => {
  let dbPath: string;
  let tempDir: string;
  let originalMethods: Record<string, unknown>;
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    dbPath = makeTempDb();
    tempDir = dirname(dbPath);
    setOutputMode(false, false, false);

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

    process.env.REDDIT_SAVED_CONFIG_DIR = configDir;
    process.env.XDG_DATA_HOME = tempDir;
    process.env.REDDIT_CLIENT_SECRET = "test-secret";

    const proto = RedditApiClient.prototype;
    originalMethods = {
      fetchSaved: proto.fetchSaved,
      fetchUpvoted: proto.fetchUpvoted,
      fetchUserPosts: proto.fetchUserPosts,
      fetchUserComments: proto.fetchUserComments,
      fetchInboxPage: proto.fetchInboxPage,
    };
    proto.fetchSaved = async () => emptyFetchResult();
    proto.fetchUpvoted = async () => emptyFetchResult();
    proto.fetchUserPosts = async () => emptyFetchResult();
    proto.fetchUserComments = async () => emptyFetchResult();
    proto.fetchInboxPage = async () => ({ items: [], after: null });
  });

  afterEach(() => {
    Object.assign(RedditApiClient.prototype, originalMethods);
    restoreFetch();
    setOutputMode(false, false, false);
    process.exitCode = originalExitCode ?? 0;
    for (const key of ["REDDIT_SAVED_CONFIG_DIR", "XDG_DATA_HOME", "REDDIT_CLIENT_SECRET"]) {
      if (originalEnv[key] !== undefined) {
        process.env[key] = originalEnv[key];
      } else {
        delete process.env[key];
      }
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  async function runJobs(flags: Record<string, string | boolean>): Promise<{
    output: { status: string; steps: Array<Record<string, unknown>> };
  }> {
    const { jobsRunCmd } = await import("../src/commands/jobs");
    const cap = captureConsole();
    try {
      await jobsRunCmd({ db: dbPath, ...flags }, []);
      return { output: JSON.parse(cap.logs.join("\n")) };
    } finally {
      cap.restore();
    }
  }

  test("runs all steps in order and records a complete job run", async () => {
    const { output } = await runJobs({});

    expect(output.status).toBe("complete");
    expect(output.steps.map((s) => s.step)).toEqual(["fetch", "context", "inbox", "backup"]);
    expect(output.steps.every((s) => s.ok)).toBe(true);
    // Backup is unconfigured in the test env — skipped but ok
    expect(output.steps[3].skipped).toBe("not-configured");

    const adapter = new SqliteAdapter(dbPath);
    try {
      const [run] = adapter.getJobRunSummaries();
      expect(run.status).toBe("complete");
      expect(run.trigger).toBe("manual");
      expect(run.steps).toHaveLength(4);
      // The inbox step records sync_runs provenance too
      const inboxRun = adapter.getSyncRunSummaries().find((s) => s.origin === "inbox");
      expect(inboxRun?.lastRun?.status).toBe("complete");
    } finally {
      adapter.close();
    }
  });

  test("a failing fetch origin marks the run errored but later steps still ran", async () => {
    RedditApiClient.prototype.fetchUpvoted = async () => {
      throw new Error("upvoted exploded");
    };

    const { output } = await runJobs({});

    expect(output.status).toBe("errored");
    expect(process.exitCode).toBe(1);

    const fetchStep = output.steps.find((s) => s.step === "fetch");
    expect(fetchStep?.ok).toBe(false);
    const detail = fetchStep?.detail as Array<{ type: string; error?: string }>;
    expect(detail.find((d) => d.type === "upvoted")?.error).toContain("upvoted exploded");
    // Other origins and later steps still ran
    expect(detail).toHaveLength(4);
    expect(output.steps.map((s) => s.step)).toEqual(["fetch", "context", "inbox", "backup"]);

    const adapter = new SqliteAdapter(dbPath);
    try {
      expect(adapter.getJobRunSummaries()[0].status).toBe("errored");
    } finally {
      adapter.close();
    }
  });

  test("--steps runs only the requested steps", async () => {
    const { output } = await runJobs({ steps: "context" });

    expect(output.steps.map((s) => s.step)).toEqual(["context"]);
    expect(output.status).toBe("complete");
  });

  test("--trigger is recorded on the job run", async () => {
    await runJobs({ steps: "context", trigger: "launchd" });

    const adapter = new SqliteAdapter(dbPath);
    try {
      expect(adapter.getJobRunSummaries()[0].trigger).toBe("launchd");
    } finally {
      adapter.close();
    }
  });

  test("skips cleanly when the lock is held and writes no provenance", async () => {
    const release = await acquireJobLock(getJobLockPathForDatabase(dbPath));
    try {
      const { jobsRunCmd } = await import("../src/commands/jobs");
      const cap = captureConsole();
      try {
        await jobsRunCmd({ db: dbPath }, []);
        const output = JSON.parse(cap.logs.join("\n"));
        expect(output).toEqual({ skipped: true, reason: "already-running" });
      } finally {
        cap.restore();
      }
    } finally {
      await release?.();
    }

    const adapter = new SqliteAdapter(dbPath);
    try {
      expect(adapter.getJobRunSummaries()).toHaveLength(0);
    } finally {
      adapter.close();
    }
  });

  test("releases the lock after a run so the next one proceeds", async () => {
    await runJobs({ steps: "context" });
    const { output } = await runJobs({ steps: "context" });
    expect(output.status).toBe("complete");
  });
});

describe("jobs status command", () => {
  let dbPath: string;
  let tempDir: string;

  beforeEach(() => {
    dbPath = makeTempDb();
    tempDir = dirname(dbPath);
    setOutputMode(false, false, true);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("reports runs and lock state", async () => {
    const seed = new SqliteAdapter(dbPath);
    const id = seed.startJobRun("manual");
    seed.finishJobRun(id, {
      status: "complete",
      steps: [{ step: "fetch", ok: true, durationMs: 1 }],
    });
    seed.close();

    const { jobsStatusCmd } = await import("../src/commands/jobs");
    const cap = captureConsole();
    try {
      await jobsStatusCmd({ db: dbPath }, []);
      const output = JSON.parse(cap.logs.join("\n"));
      expect(output.runningNow).toBe(false);
      expect(output.runs).toHaveLength(1);
      expect(output.runs[0].status).toBe("complete");
      expect(output.runs[0].crashed).toBe(false);
    } finally {
      cap.restore();
    }
  });

  test("flags a long-unfinished run as crashed", async () => {
    const seed = new SqliteAdapter(dbPath);
    seed.startJobRun("manual");
    seed.getDb().run("UPDATE job_runs SET started_at = ?", [Date.now() - 3 * 60 * 60 * 1000]);
    seed.close();

    const { jobsStatusCmd } = await import("../src/commands/jobs");
    const cap = captureConsole();
    try {
      await jobsStatusCmd({ db: dbPath }, []);
      const output = JSON.parse(cap.logs.join("\n"));
      expect(output.runs[0].crashed).toBe(true);
    } finally {
      cap.restore();
    }
  });
});
