import { Link } from "@tanstack/react-router";
import { Archive, TagIcon } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { PostCard } from "@/components/PostCard";
import { Skeleton } from "@/components/ui/skeleton";
import { SyncStatus } from "@/components/SyncStatus";
import { useAuthStatus, usePosts, useSyncStatus, useTags } from "@/hooks/queries";

export function HomePage() {
  const auth = useAuthStatus();
  const sync = useSyncStatus();
  const recent = usePosts({ limit: 12, sort: "created", dir: "desc" });
  const tags = useTags();

  const stats = sync.data?.stats;

  return (
    <div className="flex flex-col gap-6">
      <SyncStatus />

      {auth.data && auth.data.authenticated === false && !auth.data.testMode ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 text-sm">
          <p className="mb-2 font-medium">Not signed in to Reddit</p>
          <p className="mb-3 text-[var(--color-muted-foreground)]">
            Sign in to fetch your saved posts. Everything stays on your machine.
          </p>
          <Link
            to="/login"
            className="inline-flex h-9 items-center justify-center rounded-md bg-[var(--color-primary)] px-3 text-sm font-medium text-[var(--color-primary-foreground)] hover:opacity-90"
          >
            Sign in
          </Link>
        </div>
      ) : null}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Items archived"
          value={stats ? String(stats.totalPosts + stats.totalComments) : "—"}
          hint={
            stats
              ? `${stats.totalPosts} posts · ${stats.totalComments} comments · ${stats.orphanedCount} orphaned`
              : undefined
          }
        />
        <StatCard
          label="Subreddits"
          value={stats ? String(stats.subredditCounts.length) : "—"}
        />
        <StatCard
          label="Tags"
          value={tags.data ? String(tags.data.items.length) : "—"}
        />
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent</h2>
          <Link
            to="/browse"
            className="text-sm text-[var(--color-muted-foreground)] hover:underline"
          >
            Browse all →
          </Link>
        </div>

        {recent.isLoading ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-36 w-full" />
          </div>
        ) : recent.isError ? (
          <ErrorState error={recent.error} onRetry={() => recent.refetch()} />
        ) : recent.data && recent.data.items.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {recent.data.items.slice(0, 8).map((p) => (
              <PostCard key={p.id} post={p} compact />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Archive className="h-8 w-8" />}
            title="No saved posts yet"
            description="Run a sync from the Settings page to populate your archive."
          />
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Tags</h2>
        {tags.data && tags.data.items.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {tags.data.items.map((tag) => (
              <Link
                key={tag.name}
                to="/browse"
                search={{ tag: tag.name }}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-1 text-xs hover:border-[var(--color-ring)]"
                style={tag.color ? { borderColor: tag.color } : undefined}
              >
                <TagIcon className="h-3 w-3" />
                <span>{tag.name}</span>
                <span className="text-[var(--color-muted-foreground)]">({tag.count})</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            No tags yet. Open a post to add one.
          </p>
        )}
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <div className="text-xs uppercase text-[var(--color-muted-foreground)]">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {hint ? (
        <div className="mt-1 text-xs text-[var(--color-muted-foreground)]">{hint}</div>
      ) : null}
    </div>
  );
}
