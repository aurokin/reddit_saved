import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAppContext, getAppContext } from "@/api/context";
import postsRoute from "@/api/routes/posts";
import type { RedditItem } from "@reddit-cached/core";

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

describe("posts route", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "reddit-cached-web-posts-"));
    process.env.REDDIT_SAVED_DB = join(tempDir, "test.db");
  });

  afterEach(() => {
    closeAppContext();
    process.env.REDDIT_SAVED_DB = undefined;
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("search respects the requested origin filter", async () => {
    const ctx = getAppContext();
    ctx.storage.upsertPosts([makeItem("saved1", "rust patterns")], "saved");
    ctx.storage.upsertPosts([makeItem("upvoted1", "rust patterns")], "upvoted");

    const res = await postsRoute.fetch(
      new Request("http://localhost/search?q=rust&origin=saved", { method: "GET" }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string }>; total: number };
    expect(body.items.map((item) => item.id)).toEqual(["saved1"]);
    expect(body.total).toBe(1);
  });

  test("list rejects malformed pagination params", async () => {
    const limitRes = await postsRoute.fetch(
      new Request("http://localhost/?limit=abc", { method: "GET" }),
    );
    expect(limitRes.status).toBe(400);
    expect(await limitRes.text()).toContain("limit");

    const offsetRes = await postsRoute.fetch(
      new Request("http://localhost/?offset=abc", { method: "GET" }),
    );
    expect(offsetRes.status).toBe(400);
    expect(await offsetRes.text()).toContain("offset");
  });

  test("search rejects malformed pagination params", async () => {
    const limitRes = await postsRoute.fetch(
      new Request("http://localhost/search?q=rust&limit=abc", { method: "GET" }),
    );
    expect(limitRes.status).toBe(400);
    expect(await limitRes.text()).toContain("limit");

    const offsetRes = await postsRoute.fetch(
      new Request("http://localhost/search?q=rust&offset=abc", { method: "GET" }),
    );
    expect(offsetRes.status).toBe(400);
    expect(await offsetRes.text()).toContain("offset");
  });

  test("list rejects malformed numeric filters", async () => {
    const res = await postsRoute.fetch(
      new Request("http://localhost/?minScore=abc", { method: "GET" }),
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("minScore");
  });

  test("search rejects malformed numeric filters", async () => {
    const minScoreRes = await postsRoute.fetch(
      new Request("http://localhost/search?q=rust&minScore=abc", { method: "GET" }),
    );
    expect(minScoreRes.status).toBe(400);
    expect(await minScoreRes.text()).toContain("minScore");

    const afterRes = await postsRoute.fetch(
      new Request("http://localhost/search?q=rust&after=abc", { method: "GET" }),
    );
    expect(afterRes.status).toBe(400);
    expect(await afterRes.text()).toContain("after");

    const beforeRes = await postsRoute.fetch(
      new Request("http://localhost/search?q=rust&before=abc", { method: "GET" }),
    );
    expect(beforeRes.status).toBe(400);
    expect(await beforeRes.text()).toContain("before");
  });

  test("list rejects malformed after/before filters", async () => {
    const afterRes = await postsRoute.fetch(
      new Request("http://localhost/?after=abc", { method: "GET" }),
    );
    expect(afterRes.status).toBe(400);
    expect(await afterRes.text()).toContain("after");

    const beforeRes = await postsRoute.fetch(
      new Request("http://localhost/?before=abc", { method: "GET" }),
    );
    expect(beforeRes.status).toBe(400);
    expect(await beforeRes.text()).toContain("before");
  });

  test("list filters by after/before on created_utc", async () => {
    const ctx = getAppContext();
    const older = makeItem("older", "old post");
    older.data.created_utc = 1_600_000_000;
    const newer = makeItem("newer", "new post");
    newer.data.created_utc = 1_700_000_000;
    ctx.storage.upsertPosts([older, newer], "saved");

    const afterRes = await postsRoute.fetch(
      new Request("http://localhost/?after=1650000000", { method: "GET" }),
    );
    const afterBody = (await afterRes.json()) as { items: Array<{ id: string }> };
    expect(afterBody.items.map((item) => item.id)).toEqual(["newer"]);

    const beforeRes = await postsRoute.fetch(
      new Request("http://localhost/?before=1650000000", { method: "GET" }),
    );
    const beforeBody = (await beforeRes.json()) as { items: Array<{ id: string }> };
    expect(beforeBody.items.map((item) => item.id)).toEqual(["older"]);
  });

  test("list rejects unknown origin filters", async () => {
    const res = await postsRoute.fetch(
      new Request("http://localhost/?origin=bogus", { method: "GET" }),
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("origin");
  });

  test("search rejects unknown origin filters", async () => {
    const res = await postsRoute.fetch(
      new Request("http://localhost/search?q=rust&origin=bogus", { method: "GET" }),
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("origin");
  });
});
