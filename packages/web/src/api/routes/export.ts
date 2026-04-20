/**
 * Export route — streams JSON / CSV / Markdown for the current DB (optionally filtered).
 */
import { exportToCsv, exportToJson, exportToMarkdown } from "@reddit-saved/core";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { getAppContext } from "../context";

const app = new Hono();

function parseExportLimit(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new HTTPException(400, {
      message: 'Invalid "limit" query parameter. Expected a non-negative integer.',
    });
  }

  return parsed;
}

app.get("/", (c) => {
  const ctx = getAppContext();
  const format = c.req.query("format") ?? "json";
  const opts = {
    subreddit: c.req.query("subreddit"),
    tag: c.req.query("tag"),
    orphaned: c.req.query("orphaned") === "true",
    kind:
      c.req.query("kind") === "t1"
        ? ("t1" as const)
        : c.req.query("kind") === "t3"
          ? ("t3" as const)
          : undefined,
    limit: parseExportLimit(c.req.query("limit")),
    includeRawJson: c.req.query("includeRaw") === "true",
  };

  const ts = new Date().toISOString().replace(/[:.]/g, "-");

  if (format === "json") {
    const body = exportToJson(ctx.storage, opts);
    c.header("Content-Type", "application/json");
    c.header("Content-Disposition", `attachment; filename="reddit-saved-${ts}.json"`);
    return c.body(body);
  }
  if (format === "csv") {
    const body = exportToCsv(ctx.storage, opts);
    c.header("Content-Type", "text/csv");
    c.header("Content-Disposition", `attachment; filename="reddit-saved-${ts}.csv"`);
    return c.body(body);
  }
  if (format === "markdown" || format === "md") {
    const body = exportToMarkdown(ctx.storage, opts);
    c.header("Content-Type", "text/markdown");
    c.header("Content-Disposition", `attachment; filename="reddit-saved-${ts}.md"`);
    return c.body(body);
  }
  throw new HTTPException(400, { message: `Unknown format: ${format}` });
});

export default app;
