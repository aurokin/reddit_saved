import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAppContext, getAppContext } from "@/api/context";
import exportRoute from "@/api/routes/export";
import type { RedditItem } from "@reddit-saved/core";

function makeItem(id: string, title: string): RedditItem {
  return {
    kind: "t3",
    data: {
      id,
      name: `t3_${id}`,
      title,
      author: "tester",
      subreddit: "rust",
      permalink: `/r/rust/comments/${id}/test/`,
      created_utc: 1_700_000_000,
      score: 10,
    },
  };
}

describe("export route", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "reddit-saved-web-export-"));
    process.env.REDDIT_SAVED_DB = join(tempDir, "test.db");
  });

  afterEach(() => {
    closeAppContext();
    process.env.REDDIT_SAVED_DB = undefined;
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("rejects malformed limit params", async () => {
    const res = await exportRoute.fetch(
      new Request("http://localhost/?limit=abc", { method: "GET" }),
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("limit");
  });

  test("applies a valid limit to the export", async () => {
    const ctx = getAppContext();
    ctx.storage.upsertPosts([makeItem("one", "first"), makeItem("two", "second")], "saved");

    const res = await exportRoute.fetch(
      new Request("http://localhost/?limit=1", { method: "GET" }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number; posts: Array<{ id: string }> };
    expect(body.count).toBe(1);
    expect(body.posts).toHaveLength(1);
  });
});
