/**
 * Hono entry — boots the API on :3001. In production, serves Vite's dist/ SPA
 * as a fallback for any non-/api/* request.
 */
import { existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { Hono } from "hono";
import { getAppContext } from "./context";
import { cspMiddleware, errorHandler, loggerMiddleware } from "./middleware";
import authRoute from "./routes/auth";
import exportRoute from "./routes/export";
import postsRoute from "./routes/posts";
import { resolveDistAssetPath, shouldServeSpaFallback } from "./static";
import syncRoute, { unsaveHandler } from "./routes/sync";
import tagsRoute from "./routes/tags";

const PORT = Number(process.env.PORT ?? 3001);
const DIST_DIR = resolve(process.cwd(), "dist");
const IS_PROD = process.env.NODE_ENV === "production";

const app = new Hono();
app.use("*", loggerMiddleware());
app.use("*", cspMiddleware());

// Boot the singleton now so schema/migrations run before the first request
getAppContext();

app.route("/api/auth", authRoute);
app.route("/api/posts", postsRoute);
app.route("/api/tags", tagsRoute);
app.route("/api/sync", syncRoute);
app.route("/api/unsave", unsaveHandler);
app.route("/api/export", exportRoute);

app.get("/api/health", (c) => c.json({ ok: true }));

app.onError(errorHandler);

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

// SPA fallback — only in prod, only for non-/api/* paths.
if (IS_PROD) {
  if (!existsSync(DIST_DIR)) {
    console.warn(`[server] NODE_ENV=production but no dist/ found at ${DIST_DIR}. ` +
      "Run 'bun run build' first.");
  }
  app.get("*", async (c) => {
    const url = new URL(c.req.url);
    if (url.pathname.startsWith("/api/")) {
      return c.notFound();
    }
    const assetPath = resolveDistAssetPath(DIST_DIR, url.pathname);
    if (assetPath && existsSync(assetPath)) {
      const st = statSync(assetPath);
      if (st.isFile()) {
        const file = Bun.file(assetPath);
        const mime = MIME[extname(assetPath).toLowerCase()] ?? "application/octet-stream";
        c.header("Content-Type", mime);
        return c.body(await file.arrayBuffer());
      }
    }
    if (!shouldServeSpaFallback(url.pathname)) {
      return c.notFound();
    }
    // Fallback: SPA index
    const indexPath = join(DIST_DIR, "index.html");
    if (existsSync(indexPath)) {
      c.header("Content-Type", "text/html");
      return c.body(await Bun.file(indexPath).text());
    }
    return c.notFound();
  });
}

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  fetch: app.fetch,
  idleTimeout: 120, // SSE syncs may run a while
});

const ctx = getAppContext();
console.log(
  `[server] listening on http://${server.hostname}:${server.port} (testMode=${ctx.testMode}, prod=${IS_PROD})`,
);

process.on("SIGINT", () => {
  console.log("[server] shutting down");
  server.stop(false);
  process.exit(0);
});
