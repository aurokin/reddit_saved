import { formatRelative } from "@/lib/utils";
import type { InboxItemType, TodayDigest } from "@/types";
import { Link } from "@tanstack/react-router";
import { Badge } from "../ui/badge";

const TYPE_LABELS: Record<InboxItemType, string> = {
  comment_reply: "reply",
  post_reply: "reply",
  mention: "mention",
  message: "message",
};

/** Latest replies/mentions/messages from the today digest. */
export function InboxPreview({ digest }: { digest: TodayDigest | undefined }) {
  const inbox = digest?.inbox;
  const items = inbox?.items.slice(0, 3) ?? [];

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4"
      data-testid="inbox-preview"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Inbox</h3>
        <div className="flex items-center gap-2">
          {inbox && inbox.unreadCount > 0 ? (
            <Badge data-testid="inbox-unread-badge">{inbox.unreadCount} unread</Badge>
          ) : null}
          <Link
            to="/inbox"
            className="text-xs text-[var(--color-muted-foreground)] hover:underline"
          >
            View all →
          </Link>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          No new replies, mentions, or messages.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li
              key={`${item.type}-${item.author}-${item.createdUtc}`}
              className="flex items-baseline gap-2 text-sm"
            >
              {item.isNew ? (
                <span className="text-[var(--color-primary)]" aria-label="unread">
                  ●
                </span>
              ) : null}
              <span className="min-w-0 flex-1 truncate">
                <span className="text-[var(--color-muted-foreground)]">
                  {TYPE_LABELS[item.type]} from
                </span>{" "}
                u/{item.author ?? "[unknown]"}
                {item.subreddit ? (
                  <span className="text-[var(--color-muted-foreground)]">
                    {" "}
                    in r/{item.subreddit}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-xs text-[var(--color-muted-foreground)]">
                {formatRelative(item.createdUtc)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
