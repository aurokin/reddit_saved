/**
 * Posts routes — list, get, search.
 * Thin wrappers over SqliteAdapter.{listPosts,getPost,searchPosts}.
 */
import type { ContentOrigin, ListOptions, SearchOptions } from "@reddit-saved/core";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { getAppContext } from "../context";
import { assertLocalAppOrigin } from "../request-origin";

const app = new Hono();

function parseOrigin(origin: string | undefined): ContentOrigin | undefined {
  if (origin === undefined || origin.trim() === "") return undefined;

  if (
    origin === "saved" ||
    origin === "upvoted" ||
    origin === "submitted" ||
    origin === "commented"
  ) {
    return origin as ContentOrigin;
  }

  throw new HTTPException(400, {
    message:
      'Invalid "origin" query parameter. Expected one of: saved, upvoted, submitted, commented.',
  });
}

function parsePaginationParam(
  value: string | undefined,
  name: "limit" | "offset",
  defaultValue: number,
  maxValue?: number,
): number {
  if (value === undefined || value.trim() === "") return defaultValue;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new HTTPException(400, {
      message: `Invalid '${name}' query parameter. Expected a non-negative integer.`,
    });
  }

  return maxValue === undefined ? parsed : Math.min(parsed, maxValue);
}

function parseOptionalNumberParam(
  value: string | undefined,
  name: "minScore" | "after" | "before",
): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new HTTPException(400, {
      message: `Invalid '${name}' query parameter. Expected a number.`,
    });
  }

  return parsed;
}

function parseListOptions(query: Record<string, string | undefined>): ListOptions {
  const origin = query.origin;
  const kind = query.kind;
  const sort = query.sort;
  const sortDirection = query.dir;
  const orphaned = query.orphaned;
  return {
    subreddit: query.subreddit,
    author: query.author,
    tag: query.tag,
    minScore: parseOptionalNumberParam(query.minScore, "minScore"),
    kind: kind === "t1" || kind === "t3" ? kind : undefined,
    contentOrigin: parseOrigin(origin),
    orphaned: orphaned === "true" ? true : orphaned === "all" ? "all" : undefined,
    sort: sort === "score" ? "score" : "created",
    sortDirection: sortDirection === "asc" ? "asc" : "desc",
    limit: parsePaginationParam(query.limit, "limit", 50, 200),
    offset: parsePaginationParam(query.offset, "offset", 0),
  };
}

// IMPORTANT: /search must be declared BEFORE /:id, otherwise Hono's route matcher
// treats "search" as an :id and this route is unreachable.
app.get("/search", (c) => {
  const ctx = getAppContext();
  const q = c.req.query("q") ?? "";
  if (!q.trim()) {
    return c.json({ items: [], total: 0, query: q, limit: 0, offset: 0 });
  }
  const opts: SearchOptions = {
    subreddit: c.req.query("subreddit"),
    author: c.req.query("author"),
    tag: c.req.query("tag"),
    minScore: parseOptionalNumberParam(c.req.query("minScore"), "minScore"),
    kind: c.req.query("kind") === "t1" ? "t1" : c.req.query("kind") === "t3" ? "t3" : undefined,
    contentOrigin: parseOrigin(c.req.query("origin")),
    orphaned:
      c.req.query("orphaned") === "true"
        ? true
        : c.req.query("orphaned") === "all"
          ? "all"
          : undefined,
    createdAfter: parseOptionalNumberParam(c.req.query("after"), "after"),
    createdBefore: parseOptionalNumberParam(c.req.query("before"), "before"),
    limit: parsePaginationParam(c.req.query("limit"), "limit", 50, 200),
    offset: parsePaginationParam(c.req.query("offset"), "offset", 0),
  };
  const items = ctx.storage.searchPosts(q, opts);
  const total = ctx.storage.countSearchPosts(q, opts);
  return c.json({ items, total, query: q, limit: opts.limit, offset: opts.offset });
});

app.get("/", (c) => {
  const ctx = getAppContext();
  const opts = parseListOptions({
    subreddit: c.req.query("subreddit"),
    author: c.req.query("author"),
    tag: c.req.query("tag"),
    minScore: c.req.query("minScore"),
    origin: c.req.query("origin"),
    kind: c.req.query("kind"),
    orphaned: c.req.query("orphaned"),
    sort: c.req.query("sort"),
    dir: c.req.query("dir"),
    limit: c.req.query("limit"),
    offset: c.req.query("offset"),
  });
  const items = ctx.storage.listPosts(opts);
  const total = ctx.storage.countPosts(opts);
  return c.json({ items, total, limit: opts.limit, offset: opts.offset });
});

app.get("/:id", (c) => {
  const ctx = getAppContext();
  const id = c.req.param("id");
  const post = ctx.storage.getPost(id);
  if (!post) throw new HTTPException(404, { message: `Post ${id} not found` });
  return c.json(post);
});

// Post-level tag mutations live under /api/posts/:id/tags so the SPA's TagEditor
// has everything it needs on one nested resource.
app.post("/:id/tags", async (c) => {
  assertLocalAppOrigin(c, { allowEmptyOrigin: true });
  const ctx = getAppContext();
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as { tag?: string };
  if (!body.tag) throw new HTTPException(400, { message: "Missing 'tag' in body" });
  try {
    ctx.tags.addTagToPost(body.tag, id);
  } catch (err) {
    throw new HTTPException(400, { message: err instanceof Error ? err.message : String(err) });
  }
  return c.json({ ok: true });
});

app.delete("/:id/tags/:tag", (c) => {
  assertLocalAppOrigin(c, { allowEmptyOrigin: true });
  const ctx = getAppContext();
  const id = c.req.param("id");
  const tag = c.req.param("tag");
  try {
    ctx.tags.removeTagFromPost(tag, id);
  } catch (err) {
    throw new HTTPException(400, { message: err instanceof Error ? err.message : String(err) });
  }
  return c.json({ ok: true });
});

export default app;
