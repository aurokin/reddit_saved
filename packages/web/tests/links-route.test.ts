import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAppContext, getAppContext } from "@/api/context";
import linksRoute from "@/api/routes/links";
import type { RedditItem } from "@reddit-cached/core";

function makeItem(
  id: string,
  overrides: Partial<{ url: string; selftext: string; created_utc: number }> = {},
): RedditItem {
  return {
    kind: "t3",
    data: {
      id,
      name: `t3_${id}`,
      title: `Post ${id}`,
      author: "tester",
      subreddit: "test",
      permalink: `/r/test/comments/${id}/post_${id}/`,
      created_utc: overrides.created_utc ?? 1_700_000_000,
      score: 1,
      url: overrides.url,
      selftext: overrides.selftext,
    },
  };
}

async function get(path: string): Promise<Response> {
  return await linksRoute.fetch(new Request(`http://localhost${path}`, { method: "GET" }));
}

describe("links routes", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "reddit-cached-web-links-"));
    process.env.REDDIT_SAVED_DB = join(tempDir, "test.db");
  });

  afterEach(() => {
    closeAppContext();
    process.env.REDDIT_SAVED_DB = undefined;
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("GET / groups occurrences by canonical url across posts", async () => {
    const ctx = getAppContext();
    // Link indexing runs inside the upsert transaction — no rebuild step needed.
    ctx.storage.upsertPosts(
      [
        makeItem("a", { url: "https://example.com/article" }),
        makeItem("b", {
          url: "https://example.com/article",
          selftext: "see https://example.com/article again",
        }),
        makeItem("c", { url: "https://other.com/page" }),
      ],
      "saved",
    );

    const res = await get("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ canonical_url: string; postCount: number; occurrenceCount: number }>;
    };
    const article = body.items.find((l) => l.canonical_url.includes("example.com/article"));
    expect(article?.postCount).toBe(2);
    expect(article?.occurrenceCount).toBe(3);
    expect(body.items.some((l) => l.canonical_url.includes("other.com/page"))).toBe(true);
  });

  test("GET /?excludeReddit=true drops reddit-hosted links", async () => {
    const ctx = getAppContext();
    ctx.storage.upsertPosts(
      [
        makeItem("ext", { url: "https://example.com/tool" }),
        // Points at a different reddit thread, not this post's own permalink,
        // so it survives the self-link filter and lands in the index.
        makeItem("red", { url: "https://www.reddit.com/r/rust/comments/zzz/other/" }),
      ],
      "saved",
    );

    const all = (await (await get("/")).json()) as { items: Array<{ host: string }> };
    expect(all.items.some((l) => l.host.includes("reddit"))).toBe(true);

    const filtered = (await (await get("/?excludeReddit=true")).json()) as {
      items: Array<{ host: string }>;
    };
    expect(filtered.items.length).toBeGreaterThan(0);
    expect(filtered.items.some((l) => l.host.includes("reddit"))).toBe(false);
  });

  test("GET /?since= filters on the owning post's created_utc", async () => {
    const ctx = getAppContext();
    ctx.storage.upsertPosts(
      [
        makeItem("old", { url: "https://old.example.com/page", created_utc: 1_600_000_000 }),
        makeItem("new", { url: "https://new.example.com/page", created_utc: 1_700_000_000 }),
      ],
      "saved",
    );

    const res = await get("/?since=1650000000");
    const body = (await res.json()) as { items: Array<{ canonical_url: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].canonical_url).toContain("new.example.com");
  });

  test("GET / rejects malformed since and limit params", async () => {
    const sinceRes = await get("/?since=abc");
    expect(sinceRes.status).toBe(400);
    expect(await sinceRes.text()).toContain("since");

    const limitRes = await get("/?limit=abc");
    expect(limitRes.status).toBe(400);
    expect(await limitRes.text()).toContain("limit");

    const zeroRes = await get("/?limit=0");
    expect(zeroRes.status).toBe(400);
  });

  test("GET /search requires q", async () => {
    const res = await get("/search");
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("q");

    const blank = await get("/search?q=%20");
    expect(blank.status).toBe(400);
  });

  test("GET /search returns occurrences joined with post metadata", async () => {
    const ctx = getAppContext();
    ctx.storage.upsertPosts([makeItem("a", { url: "https://example.com/deep/dive" })], "saved");

    const res = await get("/search?q=deep");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ post_id: string; subreddit: string; permalink: string }>;
      query: string;
    };
    expect(body.query).toBe("deep");
    expect(body.items).toHaveLength(1);
    expect(body.items[0].post_id).toBe("a");
    expect(body.items[0].subreddit).toBe("test");
  });

  test("GET /search escapes LIKE wildcards in the query", async () => {
    const ctx = getAppContext();
    ctx.storage.upsertPosts(
      [
        makeItem("underscore", { url: "https://example.com/my_page" }),
        makeItem("letter", { url: "https://example.com/myXpage" }),
      ],
      "saved",
    );

    const res = await get("/search?q=my_page");
    const body = (await res.json()) as { items: Array<{ post_id: string }> };
    expect(body.items.map((i) => i.post_id)).toEqual(["underscore"]);
  });
});
