import type { InboxItemType, ListInboxOptions } from "@reddit-cached/core";
import { flagBool, flagInt, flagStr } from "../args";
import { createContext } from "../context";
import { isHumanMode, printJson, printTable } from "../output";

const VALID_TYPES = new Set<string>(["comment_reply", "post_reply", "mention", "message"]);

/** `inbox` — read synced inbox items from the local database (no network).
 *  Run `fetch inbox` first to sync. Unread items sort first. */
export async function inboxCmd(
  flags: Record<string, string | boolean>,
  _positionals: string[],
): Promise<void> {
  const typeStr = flagStr(flags, "type");
  if (typeStr !== undefined && !VALID_TYPES.has(typeStr)) {
    throw new Error(
      `Invalid --type: "${typeStr}". Must be one of: comment_reply, post_reply, mention, message`,
    );
  }

  const opts: ListInboxOptions = {
    type: typeStr as InboxItemType | undefined,
    unreadOnly: flagBool(flags, "unread"),
    limit: flagInt(flags, "limit") ?? 25,
  };

  const ctx = await createContext({ dbPath: flagStr(flags, "db") });

  try {
    const items = ctx.storage.listInboxItems(opts);
    const total = ctx.storage.countInboxItems(opts);
    const unreadCount = ctx.storage.countUnreadInbox();

    if (isHumanMode()) {
      printTable(
        items.map((item) => ({
          type: item.type,
          from: item.author ?? "-",
          about: item.subject ?? item.link_title ?? "-",
          subreddit: item.subreddit ? `r/${item.subreddit}` : "-",
          age: formatAge(item.created_utc),
          unread: item.is_new ? "●" : "",
        })),
        [
          { key: "unread", header: "", width: 2 },
          { key: "type", header: "Type" },
          { key: "from", header: "From" },
          { key: "about", header: "Subject", width: 40 },
          { key: "subreddit", header: "Subreddit" },
          { key: "age", header: "Age", align: "right" },
        ],
      );
      console.log(`\n${items.length} of ${total} shown · ${unreadCount} unread`);
    } else {
      printJson({ items, total, unreadCount });
    }
  } finally {
    ctx.close();
  }
}

/** Compact relative age from a created_utc in epoch seconds. */
function formatAge(createdUtc: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - createdUtc);
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 86400 * 365) return `${Math.floor(seconds / 86400)}d`;
  return `${Math.floor(seconds / (86400 * 365))}y`;
}
