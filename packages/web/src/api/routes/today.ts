/**
 * Today route — deterministic "what's new" digest for the dashboard.
 * Same builder the CLI `today` command uses; no AI, no network.
 */
import { buildTodayDigest, renderTodayDigest } from "@reddit-cached/core";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { getAppContext } from "../context";

const app = new Hono();

const HOURS_PER_MS = 3_600_000;
const MAX_WINDOW_HOURS = 24 * 90;

app.get("/", (c) => {
  const ctx = getAppContext();
  const raw = c.req.query("hours");
  let hours = 24;
  if (raw !== undefined && raw.trim() !== "") {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_WINDOW_HOURS) {
      throw new HTTPException(400, {
        message: `Invalid 'hours' query parameter. Expected a number between 1 and ${MAX_WINDOW_HOURS}.`,
      });
    }
    hours = parsed;
  }
  const digest = buildTodayDigest(ctx.storage, { windowMs: hours * HOURS_PER_MS });
  return c.json({ digest, markdown: renderTodayDigest(digest) });
});

export default app;
