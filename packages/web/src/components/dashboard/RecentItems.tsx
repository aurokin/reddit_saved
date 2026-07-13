import { usePosts } from "@/hooks/queries";
import { Link } from "@tanstack/react-router";
import { Archive } from "lucide-react";
import { EmptyState } from "../EmptyState";
import { ErrorState } from "../ErrorState";
import { PostCard } from "../PostCard";
import { Skeleton } from "../ui/skeleton";

/** The most recently created items in the archive — extracted from HomePage. */
export function RecentItems() {
  const recent = usePosts({ limit: 12, sort: "created", dir: "desc" });

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Recent</h2>
        <Link to="/browse" className="text-sm text-[var(--color-muted-foreground)] hover:underline">
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
  );
}
