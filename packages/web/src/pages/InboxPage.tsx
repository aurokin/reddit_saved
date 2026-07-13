import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useInbox } from "@/hooks/queries";
import { formatRelative } from "@/lib/utils";
import type { InboxItemType } from "@/types";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ExternalLink, Inbox } from "lucide-react";

export interface InboxFilters {
  type?: InboxItemType;
  unread?: boolean;
}

const TABS: Array<{ value: InboxItemType | undefined; label: string }> = [
  { value: undefined, label: "All" },
  { value: "comment_reply", label: "Comment replies" },
  { value: "post_reply", label: "Post replies" },
  { value: "mention", label: "Mentions" },
  { value: "message", label: "Messages" },
];

const TYPE_LABELS: Record<InboxItemType, string> = {
  comment_reply: "reply",
  post_reply: "reply",
  mention: "mention",
  message: "message",
};

export function InboxPage() {
  const search: InboxFilters = useSearch({ strict: false });
  const navigate = useNavigate();
  const inbox = useInbox({
    type: search.type,
    unread: search.unread ? true : undefined,
    limit: 100,
  });

  const setFilters = (next: InboxFilters): void => {
    void navigate({
      to: "/inbox",
      search: {
        type: next.type,
        unread: next.unread ? true : undefined,
      },
    });
  };

  return (
    <div className="flex flex-col gap-4" data-testid="inbox-page">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Inbox</h1>
        {inbox.data && inbox.data.unreadCount > 0 ? (
          <Badge data-testid="inbox-page-unread">{inbox.data.unreadCount} unread</Badge>
        ) : null}
        <label className="ml-auto flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={search.unread === true}
            onChange={(e) => setFilters({ type: search.type, unread: e.target.checked })}
            data-testid="inbox-unread-filter"
          />
          Unread only
        </label>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border text-sm">
        {TABS.map((tab) => {
          const active = search.type === tab.value;
          return (
            <button
              key={tab.label}
              type="button"
              onClick={() => setFilters({ type: tab.value, unread: search.unread })}
              className={
                active
                  ? "border-b-2 border-primary px-3 py-1.5 font-medium"
                  : "px-3 py-1.5 text-muted-foreground hover:text-foreground"
              }
              data-testid={`inbox-tab-${tab.value ?? "all"}`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {inbox.isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : inbox.isError ? (
        <ErrorState error={inbox.error} onRetry={() => inbox.refetch()} />
      ) : inbox.data && inbox.data.items.length > 0 ? (
        <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
          {inbox.data.items.map((item) => {
            const isUnread = item.is_new === 1;
            const heading =
              item.type === "message" ? (item.subject ?? "(no subject)") : (item.link_title ?? "");
            const externalHref =
              item.type === "message"
                ? `https://www.reddit.com/message/messages/${item.id}`
                : `https://www.reddit.com${item.context ?? ""}`;
            return (
              <div
                key={item.name}
                className="flex flex-col gap-1 px-3 py-2 text-sm"
                data-testid="inbox-row"
                data-unread={isUnread || undefined}
              >
                <div className="flex items-baseline gap-2">
                  {isUnread ? (
                    <span className="text-primary" aria-label="unread">
                      ●
                    </span>
                  ) : null}
                  <span className={isUnread ? "font-semibold" : undefined}>
                    {TYPE_LABELS[item.type]} from u/{item.author ?? "[unknown]"}
                  </span>
                  {item.subreddit ? (
                    <span className="text-xs text-muted-foreground">in r/{item.subreddit}</span>
                  ) : null}
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {formatRelative(item.created_utc)}
                  </span>
                </div>
                {heading ? (
                  <div className="truncate text-xs text-muted-foreground">{heading}</div>
                ) : null}
                {item.body ? <p className="line-clamp-2 text-sm">{item.body}</p> : null}
                <div className="text-xs">
                  {item.storedPostId ? (
                    <Link
                      to="/post/$id"
                      params={{ id: item.storedPostId }}
                      className="text-primary hover:underline"
                      data-testid="inbox-row-local"
                    >
                      View in archive →
                    </Link>
                  ) : (
                    <a
                      href={externalHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:underline"
                      data-testid="inbox-row-external"
                    >
                      Open on Reddit <ExternalLink className="inline h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<Inbox className="h-8 w-8" />}
          title="Inbox is empty"
          description="Run `reddit-cached fetch inbox` or wait for the scheduled job to sync replies, mentions, and messages."
        />
      )}
    </div>
  );
}
