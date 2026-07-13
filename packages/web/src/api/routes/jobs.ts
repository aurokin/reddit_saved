/**
 * Jobs route — scheduled-pipeline run history from job_runs.
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { getAppContext } from "../context";

const app = new Hono();

app.get("/", (c) => {
  const ctx = getAppContext();
  const raw = c.req.query("limit");
  let limit = 10;
  if (raw !== undefined && raw.trim() !== "") {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new HTTPException(400, {
        message: "Invalid 'limit' query parameter. Expected a positive integer.",
      });
    }
    limit = Math.min(parsed, 50);
  }
  return c.json({ items: ctx.storage.getJobRunSummaries(limit) });
});

export default app;
