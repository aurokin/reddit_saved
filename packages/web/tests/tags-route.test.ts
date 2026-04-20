import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeAppContext, getAppContext } from "@/api/context";
import postsRoute from "@/api/routes/posts";
import tagsRoute from "@/api/routes/tags";
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

function makeRequest(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  origin: string | null,
  body?: unknown,
): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      ...(origin ? { origin } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("tags routes", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "reddit-saved-web-tags-"));
    process.env.REDDIT_SAVED_DB = join(tempDir, "test.db");
  });

  afterEach(() => {
    closeAppContext();
    delete process.env.REDDIT_SAVED_DB;
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("rejects cross-origin top-level tag mutations", async () => {
    const createRes = await tagsRoute.fetch(
      makeRequest("/?unused=1", "POST", "https://evil.example", { name: "favorite" }),
    );
    expect(createRes.status).toBe(403);
    expect(await createRes.text()).toContain("Origin not permitted");

    const ctx = getAppContext();
    ctx.tags.createTag("favorite");

    const renameRes = await tagsRoute.fetch(
      makeRequest("/favorite", "PATCH", "https://evil.example", { name: "renamed" }),
    );
    expect(renameRes.status).toBe(403);
    expect(await renameRes.text()).toContain("Origin not permitted");

    const deleteRes = await tagsRoute.fetch(
      makeRequest("/favorite", "DELETE", "https://evil.example"),
    );
    expect(deleteRes.status).toBe(403);
    expect(await deleteRes.text()).toContain("Origin not permitted");
  });

  test("accepts local-origin top-level tag mutations", async () => {
    const createRes = await tagsRoute.fetch(
      makeRequest("/", "POST", "http://localhost:3001", { name: "favorite" }),
    );
    expect(createRes.status).toBe(201);

    const renameRes = await tagsRoute.fetch(
      makeRequest("/favorite", "PATCH", "http://localhost:3001", { name: "starred" }),
    );
    expect(renameRes.status).toBe(200);

    const deleteRes = await tagsRoute.fetch(
      makeRequest("/starred", "DELETE", "http://localhost:3001"),
    );
    expect(deleteRes.status).toBe(200);
  });

  test("rejects cross-origin post tag mutations", async () => {
    const ctx = getAppContext();
    ctx.storage.upsertPosts([makeItem("abc123")], "saved");
    ctx.tags.createTag("favorite");

    const addRes = await postsRoute.fetch(
      makeRequest("/abc123/tags", "POST", "https://evil.example", { tag: "favorite" }),
    );
    expect(addRes.status).toBe(403);
    expect(await addRes.text()).toContain("Origin not permitted");

    const removeRes = await postsRoute.fetch(
      makeRequest("/abc123/tags/favorite", "DELETE", "https://evil.example"),
    );
    expect(removeRes.status).toBe(403);
    expect(await removeRes.text()).toContain("Origin not permitted");
  });

  test("accepts local-origin post tag mutations", async () => {
    const ctx = getAppContext();
    ctx.storage.upsertPosts([makeItem("abc123")], "saved");
    ctx.tags.createTag("favorite");

    const addRes = await postsRoute.fetch(
      makeRequest("/abc123/tags", "POST", "http://localhost:3001", { tag: "favorite" }),
    );
    expect(addRes.status).toBe(200);

    const taggedPost = ctx.storage.getPost("abc123");
    expect(taggedPost?.tags).toBe("favorite");

    const removeRes = await postsRoute.fetch(
      makeRequest("/abc123/tags/favorite", "DELETE", "http://localhost:3001"),
    );
    expect(removeRes.status).toBe(200);

    const untaggedPost = ctx.storage.getPost("abc123");
    expect(untaggedPost?.tags).toBeNull();
  });
});
