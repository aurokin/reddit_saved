/**
 * Tag routes — CRUD over TagManager.
 * Post-scoped mutations (add/remove a tag to a single post) live under /api/posts/:id/tags.
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { getAppContext } from "../context";
import { assertLocalAppOrigin } from "../request-origin";

const app = new Hono();

app.get("/", (c) => {
  const ctx = getAppContext();
  return c.json({ items: ctx.tags.listTags() });
});

app.post("/", async (c) => {
  assertLocalAppOrigin(c, { allowEmptyOrigin: true });
  const ctx = getAppContext();
  const body = (await c.req.json().catch(() => ({}))) as { name?: string; color?: string };
  if (!body.name) throw new HTTPException(400, { message: "Missing 'name' in body" });
  try {
    const tag = ctx.tags.createTag(body.name, body.color);
    return c.json(tag, 201);
  } catch (err) {
    throw new HTTPException(409, { message: err instanceof Error ? err.message : String(err) });
  }
});

app.patch("/:name", async (c) => {
  assertLocalAppOrigin(c, { allowEmptyOrigin: true });
  const ctx = getAppContext();
  const oldName = c.req.param("name");
  const body = (await c.req.json().catch(() => ({}))) as { name?: string };
  if (!body.name) throw new HTTPException(400, { message: "Missing 'name' in body" });
  try {
    ctx.tags.renameTag(oldName, body.name);
  } catch (err) {
    throw new HTTPException(400, { message: err instanceof Error ? err.message : String(err) });
  }
  return c.json({ ok: true });
});

app.delete("/:name", (c) => {
  assertLocalAppOrigin(c, { allowEmptyOrigin: true });
  const ctx = getAppContext();
  const name = c.req.param("name");
  try {
    ctx.tags.deleteTag(name);
  } catch (err) {
    throw new HTTPException(404, { message: err instanceof Error ? err.message : String(err) });
  }
  return c.json({ ok: true });
});

export default app;
