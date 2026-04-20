import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

type AssertLocalOriginOptions = {
  allowEmptyOrigin?: boolean;
};

function isLoopbackOrigin(value: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(value);
}

function isLoopbackReferer(value: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(?:\/|$)/.test(value);
}

function isExtensionUrl(value: string): boolean {
  return value.startsWith("chrome-extension://") || value.startsWith("moz-extension://");
}

/** Restrict browser-triggered state changes to loopback UI pages or the companion extension. */
export function assertLocalAppOrigin(
  c: Context,
  { allowEmptyOrigin = false }: AssertLocalOriginOptions = {},
): void {
  const origin = c.req.header("origin") ?? "";
  const referer = c.req.header("referer") ?? "";
  const emptyOriginAllowed =
    allowEmptyOrigin &&
    origin === "" &&
    (referer === "" || isExtensionUrl(referer) || isLoopbackReferer(referer));
  const allowed =
    emptyOriginAllowed ||
    isExtensionUrl(origin) ||
    isExtensionUrl(referer) ||
    isLoopbackOrigin(origin) ||
    isLoopbackReferer(referer);

  if (!allowed) {
    throw new HTTPException(403, {
      message: `Origin not permitted: ${origin || referer || "<empty>"}`,
    });
  }
}
