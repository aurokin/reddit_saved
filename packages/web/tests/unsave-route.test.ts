import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeAppContext, getAppContext } from "@/api/context";
import { unsaveHandler } from "@/api/routes/sync";
import type { RedditItem } from "@reddit-saved/core";

function makeItem(id: string): RedditItem {
  return {
    kind: "t3",
    data: {
      id,
      name: `t3_${id}`,
      title: `Post ${id}`,
      author: "tester",
      subreddit: "test",
      permalink: `/r/test/comments/${id}/post_${id}/`,
      created_utc: 1_700_000_000,
      score: 1,
    },
  };
}

describe("unsave route", () => {
  let tempDir: string;
  let ctx: ReturnType<typeof getAppContext>;
  let originalUnsaveItems: typeof ctx.apiClient.unsaveItems;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "reddit-saved-web-unsave-"));
    process.env.REDDIT_SAVED_DB = join(tempDir, "test.db");
    ctx = getAppContext();
    originalUnsaveItems = ctx.apiClient.unsaveItems.bind(ctx.apiClient);
  });

  afterEach(() => {
    ctx.apiClient.unsaveItems = originalUnsaveItems;
    closeAppContext();
    delete process.env.REDDIT_SAVED_DB;
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("returns failed unsaves using local post ids", async () => {
    ctx.storage.upsertPosts([makeItem("abc123")], "saved");
    ctx.apiClient.unsaveItems = async () => ({
      succeeded: [],
      failed: [{ id: "t3_abc123", error: new Error("Stale reddit.com cookies") }],
      wasCancelled: false,
    });

    const res = await unsaveHandler.fetch(
      new Request("http://localhost/", {
        method: "POST",
        body: JSON.stringify({ ids: ["abc123"], confirm: true }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      succeeded: [],
      failed: [{ id: "abc123", error: "Stale reddit.com cookies" }],
      cancelled: false,
    });
  });

  test("rejects cross-origin unsave requests", async () => {
    const res = await unsaveHandler.fetch(
      new Request("http://localhost/", {
        method: "POST",
        body: JSON.stringify({ ids: ["abc123"], confirm: true }),
        headers: {
          "Content-Type": "text/plain",
          origin: "https://evil.example",
        },
      }),
    );

    expect(res.status).toBe(403);
    expect(await res.text()).toContain("Origin not permitted");
  });
});
