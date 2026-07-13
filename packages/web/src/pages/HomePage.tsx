import { SyncStatus } from "@/components/SyncStatus";
import { ActivityOverview } from "@/components/dashboard/ActivityOverview";
import { ContextProgressCard } from "@/components/dashboard/ContextProgressCard";
import { InboxPreview } from "@/components/dashboard/InboxPreview";
import { RecentItems } from "@/components/dashboard/RecentItems";
import { SyncHealthCard } from "@/components/dashboard/SyncHealthCard";
import { TodayStrip } from "@/components/dashboard/TodayStrip";
import { TopLinksCard } from "@/components/dashboard/TopLinksCard";
import { useAuthStatus, useSyncRuns, useSyncStatus, useTags, useToday } from "@/hooks/queries";
import type { ContentOrigin } from "@/types";
import { Link } from "@tanstack/react-router";
import { TagIcon } from "lucide-react";

const ORIGINS: ContentOrigin[] = ["saved", "upvoted", "submitted", "commented"];

export function HomePage() {
  const auth = useAuthStatus();
  const sync = useSyncStatus();
  const runs = useSyncRuns();
  const today = useToday(24);
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

      <TodayStrip />

      <section
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
        data-testid="dashboard-sync-health"
      >
        {ORIGINS.map((origin) => (
          <SyncHealthCard
            key={origin}
            origin={origin}
            summary={runs.data?.items.find((r) => r.origin === origin)}
            activeCount={stats?.activeCountByOrigin[origin]}
          />
        ))}
      </section>

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ActivityOverview digest={today.data?.digest} />
        <InboxPreview digest={today.data?.digest} />
      </section>

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <TopLinksCard />
        <ContextProgressCard stats={stats} />
      </section>

      <RecentItems />

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
