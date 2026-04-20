import { Link } from "@tanstack/react-router";
import { ExternalLink, MessageSquare, ThumbsUp } from "lucide-react";
import {
  SEARCH_SNIPPET_HIGHLIGHT_END,
  SEARCH_SNIPPET_HIGHLIGHT_START,
} from "@reddit-saved/core/search-snippet";
import type { PostRow, SearchResult } from "@/types";
import { formatNumber, formatRelative, parseTags } from "@/lib/utils";
import { TagChips } from "./TagChips";
import { Badge } from "./ui/badge";

export interface PostCardProps {
  post: PostRow | SearchResult;
  snippet?: string;
  onClick?: () => void;
  compact?: boolean;
}

export function PostCard({ post, snippet, onClick, compact }: PostCardProps) {
  const tags = parseTags(post.tags);
  const isComment = post.kind === "t1";
  const isOrphaned = post.is_on_reddit === 0;
  const title = isComment
    ? post.link_title ?? "(comment)"
    : post.title ?? "(untitled)";
  const displayText = isComment ? post.body : post.selftext;

  return (
    <article
      onClick={onClick}
      className="group flex flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 transition-colors hover:border-[var(--color-ring)]"
      data-testid="post-card"
      data-post-id={post.id}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
        <Link
          to="/browse"
          search={{ subreddit: post.subreddit }}
          className="font-medium text-[var(--color-foreground)] hover:underline"
        >
          r/{post.subreddit}
        </Link>
        <span>·</span>
        <Link
          to="/browse"
          search={{ author: post.author }}
          className="hover:underline"
        >
          u/{post.author}
        </Link>
        <span>·</span>
        <time dateTime={new Date(post.created_utc * 1000).toISOString()}>
          {formatRelative(post.created_utc)}
        </time>
        {isComment ? (
          <Badge variant="outline" className="text-[10px] uppercase">
            Comment
          </Badge>
        ) : null}
        {isOrphaned ? (
          <Badge variant="destructive" className="text-[10px] uppercase">
            Orphaned
          </Badge>
        ) : null}
        {post.over_18 ? (
          <Badge variant="destructive" className="text-[10px] uppercase">
            NSFW
          </Badge>
        ) : null}
      </div>

      <Link
        to="/post/$id"
        params={{ id: post.id }}
        className="text-base font-semibold leading-snug text-[var(--color-foreground)] no-underline hover:text-[var(--color-primary)]"
      >
        {title}
      </Link>

      {snippet ? (
        <p
          className="fts-snippet line-clamp-3 text-sm text-[var(--color-muted-foreground)]"
          // Snippet arrives with placeholder highlight markers from FTS. Escape the
          // full payload, then restore only those markers as <b> tags.
          dangerouslySetInnerHTML={{ __html: sanitizeSnippet(snippet) }}
        />
      ) : !compact && displayText ? (
        <p className="line-clamp-2 text-sm text-[var(--color-muted-foreground)] whitespace-pre-wrap">
          {displayText}
        </p>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-4 text-xs text-[var(--color-muted-foreground)]">
        <span className="inline-flex items-center gap-1">
          <ThumbsUp className="h-3.5 w-3.5" />
          {formatNumber(post.score)}
        </span>
        {post.num_comments != null ? (
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="h-3.5 w-3.5" />
            {formatNumber(post.num_comments)}
          </span>
        ) : null}
        {post.domain && post.domain !== "i.redd.it" && !post.is_self ? (
          <span className="inline-flex items-center gap-1">
            <ExternalLink className="h-3.5 w-3.5" />
            {post.domain}
          </span>
        ) : null}
        <TagChips tags={tags} />
      </div>
    </article>
  );
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Escape all HTML and restore only our search-highlight markers as <b> tags. */
function sanitizeSnippet(html: string): string {
  return escapeHtml(html)
    .replaceAll(SEARCH_SNIPPET_HIGHLIGHT_START, "<b>")
    .replaceAll(SEARCH_SNIPPET_HIGHLIGHT_END, "</b>");
}
