import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAppContext, getAppContext } from "@/api/context";
import jobsRoute from "@/api/routes/jobs";

function get(path: string): Promise<Response> {
  return Promise.resolve(
    jobsRoute.fetch(new Request(`http://localhost${path}`, { method: "GET" })),
  );
}

describe("jobs route", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "reddit-saved-web-jobs-"));
    process.env.REDDIT_SAVED_DB = join(tempDir, "test.db");
  });

  afterEach(() => {
    closeAppContext();
    process.env.REDDIT_SAVED_DB = undefined;
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("returns empty history before any pipeline run", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [] });
  });

  test("returns recorded job runs with step results", async () => {
    const ctx = getAppContext();
    const id = ctx.storage.startJobRun("launchd");
    ctx.storage.finishJobRun(id, {
      status: "errored",
      steps: [
        { step: "fetch", ok: true, durationMs: 100 },
        { step: "inbox", ok: false, durationMs: 5, error: "boom" },
      ],
    });

    const body = (await (await get("/")).json()) as {
      items: Array<{
        status: string;
        trigger: string;
        steps: Array<{ step: string; ok: boolean }>;
      }>;
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].status).toBe("errored");
    expect(body.items[0].trigger).toBe("launchd");
    expect(body.items[0].steps.map((s) => s.step)).toEqual(["fetch", "inbox"]);
  });

  test("rejects malformed limit", async () => {
    const res = await get("/?limit=abc");
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("limit");
  });
});
