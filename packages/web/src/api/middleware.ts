import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";

/** Reddit CDN allowlist for media loaded by the SPA. */
const REDDIT_MEDIA_HOSTS = [
  "https://i.redd.it",
  "https://v.redd.it",
  "https://preview.redd.it",
  "https://external-preview.redd.it",
  "https://a.thumbs.redditmedia.com",
  "https://b.thumbs.redditmedia.com",
];

export function cspMiddleware(): MiddlewareHandler {
  const isDev = process.env.NODE_ENV !== "production";
  const imgSrc = ["'self'", "data:", "blob:", ...REDDIT_MEDIA_HOSTS].join(" ");
  const mediaSrc = ["'self'", "blob:", ...REDDIT_MEDIA_HOSTS].join(" ");
  // In dev, Vite injects inline modules + HMR websocket. In prod we keep scripts self-only.
  const scriptSrc = isDev
    ? "'self' 'unsafe-inline' 'unsafe-eval'"
    : "'self'";
  const styleSrc = isDev ? "'self' 'unsafe-inline'" : "'self' 'unsafe-inline'";
  const connectSrc = isDev ? "'self' ws: wss:" : "'self'";

  const directives = [
    "default-src 'self'",
    `img-src ${imgSrc}`,
    `media-src ${mediaSrc}`,
    `script-src ${scriptSrc}`,
    `style-src ${styleSrc}`,
    `font-src 'self' data:`,
    `connect-src ${connectSrc}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
  ].join("; ");

  return async (c, next) => {
    await next();
    c.header("Content-Security-Policy", directives);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
  };
}

export function loggerMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const start = performance.now();
    try {
      await next();
    } finally {
      const ms = Math.round(performance.now() - start);
      const line = `${c.req.method} ${c.req.path} -> ${c.res.status} (${ms}ms)`;
      if (c.res.status >= 500) console.error(line);
      else if (c.res.status >= 400) console.warn(line);
      else if (process.env.NODE_ENV !== "production") console.log(line);
    }
  };
}

interface ErrorJson {
  error: string;
  code?: string;
}

export function errorHandler(err: unknown, c: Context): Response {
  if (err instanceof HTTPException) {
    const res = err.getResponse();
    // HTTPException may return an HTML body; normalize to JSON
    const body: ErrorJson = { error: err.message };
    return c.json(body, res.status as 400 | 401 | 403 | 404 | 500);
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error("[api] unhandled error:", err);
  return c.json({ error: message, code: "INTERNAL_ERROR" } satisfies ErrorJson, 500);
}
