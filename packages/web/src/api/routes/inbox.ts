/**
 * Inbox routes — read-only views over inbox_items (replies, mentions, PMs).
 */
import type { InboxItemType, ListInboxOptions } from "@reddit-cached/core";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { getAppContext } from "../context";

const app = new Hono();

const INBOX_TYPES: ReadonlySet<string> = new Set([
  "comment_reply",
  "post_reply",
  "mention",
  "message",
]);

function parseType(value: string | undefined): InboxItemType | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  if (INBOX_TYPES.has(value)) return value as InboxItemType;
  throw new HTTPException(400, {
    message:
      "Invalid 'type' query parameter. Expected one of: comment_reply, post_reply, mention, message.",
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

app.get("/", (c) => {
  const ctx = getAppContext();
  const opts: ListInboxOptions = {
    type: parseType(c.req.query("type")),
    unreadOnly: c.req.query("unread") === "true",
    limit: parsePaginationParam(c.req.query("limit"), "limit", 25, 200),
    offset: parsePaginationParam(c.req.query("offset"), "offset", 0),
  };
  // t1 replies/mentions are mirrored into posts as context rows, so the SPA
  // can deep-link into the local thread view when the row exists.
  const items = ctx.storage.listInboxItems(opts).map((item) => ({
    ...item,
    storedPostId: ctx.storage.getPost(item.id) ? item.id : null,
  }));
  return c.json({
    items,
    total: ctx.storage.countInboxItems(opts),
    unreadCount: ctx.storage.countUnreadInbox(),
  });
});

export default app;
