/**
 * Auth routes — status, login, logout, and the cookie-session endpoints
 * consumed by the companion browser extension.
 *
 * In TEST_MODE, /login is a no-op since Playwright seeds auth.json directly.
 */
import { type OAuthServerHandle, type SessionPayload, startOAuthServer } from "@reddit-saved/core";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { canFallbackToOAuth } from "../auth-routing";
import { getAppContext } from "../context";
import { assertLocalAppOrigin } from "../request-origin";

const app = new Hono();
const TOKEN_REFRESH_SKEW_MS = 60_000;

let pendingLogin: OAuthServerHandle | null = null;

app.get("/status", async (c) => {
  const ctx = getAppContext();
  // Session auth wins when present — mirrors CompositeAuthProvider precedence.
  let session = ctx.sessionManager.getSummary();
  let sessionError: string | null = null;
  let allowOAuthFallback = true;
  try {
    if (!session) {
      await ctx.sessionManager.load();
      session = ctx.sessionManager.getSummary();
    }
    if (session) {
      try {
        await ctx.sessionManager.ensureValid();
        const summary = ctx.sessionManager.getSummary();
        return c.json({
          authenticated: true,
          username: summary?.username ?? session.username,
          mode: "session",
          capturedAt: summary?.capturedAt ?? session.capturedAt,
          testMode: ctx.testMode,
        });
      } catch (err) {
        sessionError = err instanceof Error ? err.message : String(err);
        allowOAuthFallback = await canFallbackToOAuth(ctx.tokenManager, session.username, err);
      }
    }
  } catch (err) {
    // Corrupt session.json — surface but keep going so OAuth still works.
    sessionError = err instanceof Error ? err.message : String(err);
    console.warn("[auth/status] session load failed:", sessionError);
  }

  if (!allowOAuthFallback) {
    return c.json({
      authenticated: false,
      username: null,
      mode: null,
      error: sessionError,
      testMode: ctx.testMode,
    });
  }

  try {
    const settings = await ctx.tokenManager.load({ requireClientSecret: false });
    if (!settings) {
      return c.json({
        authenticated: false,
        username: null,
        mode: null,
        ...(sessionError ? { error: sessionError } : {}),
        testMode: ctx.testMode,
      });
    }

    if (settings.tokenExpiry <= Date.now() + TOKEN_REFRESH_SKEW_MS && !settings.clientSecret) {
      return c.json({
        authenticated: false,
        username: null,
        mode: null,
        error:
          "REDDIT_CLIENT_SECRET env var is not set. This is required for token refresh. " +
          "Set the env var and retry, or re-authenticate with 'reddit-saved auth login'.",
        testMode: ctx.testMode,
      });
    }

    await ctx.tokenManager.ensureValid();
    const current = ctx.tokenManager.getSettings();
    return c.json({
      authenticated: true,
      username: current.username || settings.username || null,
      mode: "oauth",
      testMode: ctx.testMode,
    });
  } catch (err) {
    const message = sessionError ?? (err instanceof Error ? err.message : String(err));
    return c.json({
      authenticated: false,
      username: null,
      mode: null,
      error: message,
      testMode: ctx.testMode,
    });
  }
});

app.post("/login", async (c) => {
  assertLocalAppOrigin(c, { allowEmptyOrigin: true });
  const ctx = getAppContext();
  if (ctx.testMode) {
    // TEST_MODE short-circuits — Playwright seeds auth.json before tests run.
    return c.json({ started: true, authorizeUrl: null, testMode: true });
  }

  const body = await c.req.json().catch(() => ({}));
  const clientId =
    process.env.REDDIT_CLIENT_ID ?? (typeof body.clientId === "string" ? body.clientId : undefined);
  const clientSecret =
    process.env.REDDIT_CLIENT_SECRET ??
    (typeof body.clientSecret === "string" ? body.clientSecret : undefined);

  if (!clientId || !clientSecret) {
    throw new HTTPException(400, {
      message:
        "Missing Reddit credentials. Set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET env vars, or pass them in the request body.",
    });
  }

  // If a prior flow is still pending, shut it down to free port 9638.
  if (pendingLogin) {
    try {
      pendingLogin.stop();
    } catch {
      /* ignore */
    }
    pendingLogin = null;
  }

  try {
    const returnTo = typeof body.returnTo === "string" ? body.returnTo : undefined;
    pendingLogin = await startOAuthServer({
      clientId,
      clientSecret,
      returnTo,
      onSuccess: () => {
        pendingLogin = null;
      },
      onError: (error) => {
        console.error("[auth/login]", error.message);
        pendingLogin = null;
      },
    });
    // Don't await done — return the authorize URL for the client to open
    pendingLogin.done.catch(() => {
      /* resolved elsewhere; prevent unhandled rejection */
    });
    return c.json({ started: true, authorizeUrl: pendingLogin.authorizeUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new HTTPException(500, { message });
  }
});

app.post("/logout", async (c) => {
  assertLocalAppOrigin(c, { allowEmptyOrigin: true });
  const ctx = getAppContext();
  await Promise.all([ctx.tokenManager.logout(), ctx.sessionManager.disconnect()]);
  return c.json({ ok: true });
});

// ----------------------------------------------------------------------------
// Cookie-session endpoints — used by the companion browser extension.
// ----------------------------------------------------------------------------

function isSessionPayload(value: unknown): value is SessionPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.cookies) &&
    typeof v.cookieHeader === "string" &&
    v.cookieHeader.length > 0 &&
    typeof v.userAgent === "string" &&
    v.userAgent.length > 0 &&
    (v.capturedAt === undefined ||
      (typeof v.capturedAt === "number" && Number.isFinite(v.capturedAt)))
  );
}

app.post("/session", async (c) => {
  assertLocalAppOrigin(c, { allowEmptyOrigin: true });
  const ctx = getAppContext();
  const body = await c.req.json().catch(() => null);
  if (!isSessionPayload(body)) {
    throw new HTTPException(400, { message: "Invalid session payload" });
  }
  let settings: Awaited<ReturnType<typeof ctx.sessionManager.ingest>>;
  try {
    settings = await ctx.sessionManager.ingest(body);
  } catch (err) {
    if ((err as Error & { code?: string }).code === "SESSION_INVALID") {
      return c.json(
        {
          ok: false,
          code: "SESSION_INVALID",
          message: err instanceof Error ? err.message : String(err),
        },
        401,
      );
    }
    if ((err as Error & { code?: string }).code === "SESSION_BLOCKED") {
      return c.json(
        {
          ok: false,
          code: "SESSION_BLOCKED",
          message: "Extension session sync is disabled until you reconnect from the app.",
        },
        409,
      );
    }
    throw err;
  }
  return c.json({
    ok: true,
    username: settings.username,
    capturedAt: settings.capturedAt,
  });
});

app.get("/session", async (c) => {
  const ctx = getAppContext();
  // load() may throw on a corrupt file — surface as a JSON error rather than 500.
  try {
    if (!ctx.sessionManager.isAuthenticated()) {
      await ctx.sessionManager.load();
    }
    const blocked = await ctx.sessionManager.getBlockedState();
    const summary = ctx.sessionManager.getSummary();
    if (!summary) return c.json({ connected: false, blocked: !!blocked });
    await ctx.sessionManager.ensureValid();
    return c.json({ connected: true, blocked: false, ...ctx.sessionManager.getSummary() });
  } catch (err) {
    if ((err as Error & { code?: string }).code === "SESSION_INVALID") {
      const blocked = await ctx.sessionManager.getBlockedState().catch(() => null);
      return c.json({ connected: false, blocked: !!blocked }, 200);
    }
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ connected: false, blocked: false, error: message }, 200);
  }
});

app.delete("/session", async (c) => {
  const ctx = getAppContext();
  await ctx.sessionManager.disconnect();
  return c.json({ ok: true });
});

app.post("/session/clear", async (c) => {
  assertLocalAppOrigin(c, { allowEmptyOrigin: true });
  const ctx = getAppContext();
  await ctx.sessionManager.clear();
  return c.json({ ok: true });
});

app.post("/session/reconnect", async (c) => {
  assertLocalAppOrigin(c, { allowEmptyOrigin: true });
  const ctx = getAppContext();
  await ctx.sessionManager.reconnect();
  return c.json({ ok: true });
});

export default app;
