import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAppContext, getAppContext } from "@/api/context";
import todayRoute from "@/api/routes/today";
import type { RedditItem, TodayDigest } from "@reddit-saved/core";

function makeItem(id: string): RedditItem {
  return {
    kind: "t3",
    data: {
      id,
      name: `t3_${id}`,
      title: `Post ${id}`,
      author: "tester",
      subreddit: "test",
      permalink: `/r/test/comments/${id}/post/`,
      created_utc: Math.floor(Date.now() / 1000) - 3600,
      score: 10,
    },
  };
}

function get(path: string): Promise<Response> {
  return Promise.resolve(
    todayRoute.fetch(new Request(`http://localhost${path}`, { method: "GET" })),
  );
}

describe("today route", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "reddit-saved-web-today-"));
    process.env.REDDIT_SAVED_DB = join(tempDir, "test.db");
  });

  afterEach(() => {
    closeAppContext();
    process.env.REDDIT_SAVED_DB = undefined;
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("returns digest and markdown for freshly fetched items", async () => {
    const ctx = getAppContext();
    ctx.storage.upsertPosts([makeItem("a"), makeItem("b")], "saved");

    const res = await get("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { digest: TodayDigest; markdown: string };
    const saved = body.digest.newByOrigin.find((o) => o.origin === "saved");
    // fetched_at is set at upsert time, so both items are new-to-archive.
    expect(saved?.count).toBe(2);
    expect(body.digest.windowMs).toBe(24 * 3_600_000);
    expect(body.markdown).toContain("# Today: last 24h");
    expect(body.markdown).toContain("## Activity");
  });

  test("hours parameter adjusts the window", async () => {
    const res = await get("/?hours=48");
    const body = (await res.json()) as { digest: TodayDigest; markdown: string };
    expect(body.digest.windowMs).toBe(48 * 3_600_000);
    expect(body.markdown).toContain("# Today: last 48h");
  });

  test("rejects malformed hours", async () => {
    for (const bad of ["abc", "0", "-5", "999999"]) {
      const res = await get(`/?hours=${bad}`);
      expect(res.status).toBe(400);
      expect(await res.text()).toContain("hours");
    }
  });
});
