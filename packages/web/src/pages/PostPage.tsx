import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ErrorState } from "@/components/ErrorState";
import { MediaEmbed } from "@/components/MediaEmbed";
import { TagEditor } from "@/components/TagEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePost, useUnsave } from "@/hooks/queries";
import { formatNumber, formatRelative } from "@/lib/utils";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft, ExternalLink, MessageSquare, ThumbsUp, Trash2 } from "lucide-react";
import { useState } from "react";

export function PostPage() {
  const { id } = useParams({ from: "/post/$id" });
  const navigate = useNavigate();
  const { data: post, isLoading, error, refetch } = usePost(id);
  const unsave = useUnsave();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [unsaveError, setUnsaveError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !post) {
    return <ErrorState error={error ?? new Error("Post not found")} onRetry={() => refetch()} />;
  }

  const isComment = post.kind === "t1";
  const title = isComment ? (post.link_title ?? "(comment)") : (post.title ?? "(untitled)");
  const body = isComment ? post.body : post.selftext;
  const redditUrl = `https://reddit.com${post.permalink}`;

  const onUnsave = async (): Promise<void> => {
    setUnsaveError(null);
    const result = await unsave.mutateAsync({ ids: [post.id], confirm: true });
    if (result.succeeded.includes(post.id)) {
      setConfirmOpen(false);
      void navigate({ to: "/browse" });
      return;
    }

    setConfirmOpen(false);
    const failure = result.failed.find((item) => item.id === post.id);
    setUnsaveError(
      failure?.error ??
        (result.cancelled
          ? "Unsave was cancelled before Reddit confirmed the change."
          : "Reddit did not confirm the unsave."),
    );
  };

  return (
    <article className="flex flex-col gap-5" data-testid="post-page">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link to="/browse">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
        </Button>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={redditUrl} target="_blank" rel="noreferrer noopener">
              <ExternalLink className="h-3.5 w-3.5" /> Reddit
            </a>
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setConfirmOpen(true)}
            disabled={post.is_on_reddit === 0}
            data-testid="unsave-button"
          >
            <Trash2 className="h-3.5 w-3.5" /> Unsave
          </Button>
        </div>
      </div>

      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
          <Link
            to="/browse"
            search={{ subreddit: post.subreddit }}
            className="font-medium text-[var(--color-foreground)] hover:underline"
          >
            r/{post.subreddit}
          </Link>
          <span>·</span>
          <Link to="/browse" search={{ author: post.author }} className="hover:underline">
            u/{post.author}
          </Link>
          <span>·</span>
          <time dateTime={new Date(post.created_utc * 1000).toISOString()}>
            {formatRelative(post.created_utc)}
          </time>
          {isComment ? <Badge variant="outline">Comment</Badge> : null}
          {post.is_on_reddit === 0 ? <Badge variant="destructive">Orphaned</Badge> : null}
          {post.over_18 ? <Badge variant="destructive">NSFW</Badge> : null}
          {post.content_origin ? (
            <Badge variant="outline" className="capitalize">
              {post.content_origin}
            </Badge>
          ) : null}
        </div>
        <h1 className="text-2xl font-semibold leading-tight">{title}</h1>
        {post.link_title && isComment ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">On post: {post.link_title}</p>
        ) : null}
        <div className="flex items-center gap-4 text-xs text-[var(--color-muted-foreground)]">
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
        </div>
      </header>

      {!isComment ? <MediaEmbed post={post} /> : null}

      {body ? (
        <div className="reddit-body max-w-3xl whitespace-pre-wrap text-sm leading-relaxed">
          {body}
        </div>
      ) : null}

      <section className="flex flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        <h2 className="text-sm font-semibold">Tags</h2>
        <TagEditor post={post} />
      </section>

      {unsaveError ? (
        <p className="text-sm text-[var(--color-destructive)]" role="alert">
          {unsaveError}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Unsave this post on Reddit?"
        description="This removes it from your Reddit saved list. The local archive will remain."
        confirmLabel="Unsave"
        destructive
        pending={unsave.isPending}
        onConfirm={onUnsave}
      />
    </article>
  );
}
