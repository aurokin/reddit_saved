import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { SqliteAdapter } from "@reddit-cached/core";
import { parseWindowMs, todayCmd } from "../src/commands/today";
import { setOutputMode } from "../src/output";
import { captureConsole, makeTempDb } from "./helpers";

const HOUR = 3_600_000;

describe("parseWindowMs", () => {
  const cases: Array<{ input: string | undefined; expected: number | "since-last-job" }> = [
    { input: undefined, expected: 24 * HOUR },
    { input: "24h", expected: 24 * HOUR },
    { input: "36h", expected: 36 * HOUR },
    { input: "7d", expected: 7 * 24 * HOUR },
    { input: "since-last-job", expected: "since-last-job" },
  ];

  for (const c of cases) {
    test(`parses ${c.input ?? "(default)"}`, () => {
      expect(parseWindowMs(c.input)).toBe(c.expected);
    });
  }

  test("rejects invalid windows", () => {
    expect(() => parseWindowMs("90x")).toThrow(/Invalid --window/);
    expect(() => parseWindowMs("h")).toThrow(/Invalid --window/);
  });
});

describe("today command", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTempDb();
    setOutputMode(false, false, true);
  });

  afterEach(() => {
    rmSync(dirname(dbPath), { recursive: true, force: true });
  });

  test("emits the digest as JSON with --json", async () => {
    const cap = captureConsole();
    try {
      await todayCmd({ db: dbPath, json: true }, []);
      const output = JSON.parse(cap.logs.join("\n"));
      expect(output.windowMs).toBe(24 * HOUR);
      expect(Array.isArray(output.newByOrigin)).toBe(true);
      expect(output.newByOrigin).toHaveLength(4);
    } finally {
      cap.restore();
    }
  });

  test("since-last-job uses the last complete run's start", async () => {
    const seed = new SqliteAdapter(dbPath);
    const id = seed.startJobRun("manual");
    seed.finishJobRun(id, { status: "complete", steps: [] });
    seed.getDb().run("UPDATE job_runs SET started_at = ?", [Date.now() - 3 * HOUR]);
    seed.close();

    const cap = captureConsole();
    try {
      await todayCmd({ db: dbPath, window: "since-last-job", json: true }, []);
      const output = JSON.parse(cap.logs.join("\n"));
      // ~3h window (allow slack for test execution time)
      expect(output.windowMs).toBeGreaterThan(2.9 * HOUR);
      expect(output.windowMs).toBeLessThan(3.2 * HOUR);
    } finally {
      cap.restore();
    }
  });

  test("since-last-job falls back to 24h when no run exists", async () => {
    const cap = captureConsole();
    try {
      await todayCmd({ db: dbPath, window: "since-last-job", json: true }, []);
      const output = JSON.parse(cap.logs.join("\n"));
      expect(output.windowMs).toBe(24 * HOUR);
    } finally {
      cap.restore();
    }
  });
});
