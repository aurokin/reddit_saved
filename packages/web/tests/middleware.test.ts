import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { cspMiddleware } from "@/api/middleware";

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalNodeEnv === undefined) {
    process.env.NODE_ENV = undefined;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
});

describe("cspMiddleware", () => {
  test("includes explicit HTTPS Reddit media origins in production", async () => {
    process.env.NODE_ENV = "production";

    const app = new Hono();
    app.use("*", cspMiddleware());
    app.get("/api/health", (c) => c.json({ ok: true }));

    const res = await app.request("http://localhost/api/health");
    const csp = res.headers.get("content-security-policy");

    expect(res.status).toBe(200);
    expect(csp).toContain("img-src 'self' data: blob: https://i.redd.it https://v.redd.it");
    expect(csp).toContain("https://preview.redd.it");
    expect(csp).toContain("https://external-preview.redd.it");
    expect(csp).toContain("https://a.thumbs.redditmedia.com");
    expect(csp).toContain("https://b.thumbs.redditmedia.com");
    expect(csp).toContain("media-src 'self' blob: https://i.redd.it https://v.redd.it");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  });
});
