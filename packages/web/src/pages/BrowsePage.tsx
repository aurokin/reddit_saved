import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { FilterPanel } from "@/components/FilterPanel";
import { PostList } from "@/components/PostList";
import { SearchBar } from "@/components/SearchBar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSearchPosts, useSyncStatus, usePosts, useTags } from "@/hooks/queries";
import type { BrowseFilters } from "@/types";

const PAGE_SIZE = 50;

export function BrowsePage() {
  const filters = useSearch({ from: "/browse" }) as BrowseFilters;
  const navigate = useNavigate({ from: "/browse" });
  const tags = useTags();
  const sync = useSyncStatus();
  const subreddits = sync.data?.stats.subredditCounts.map((s) => s.subreddit) ?? [];

  const isSearch = !!(filters.q && filters.q.trim().length > 0);
  const page = filters.page && filters.page > 1 ? filters.page : 1;
  const offset = (page - 1) * PAGE_SIZE;

  const listParams = useMemo(
    () => ({
      subreddit: filters.subreddit,
      author: filters.author,
      minScore: filters.minScore,
      tag: filters.tag,
      origin: filters.origin,
      kind: filters.kind,
      orphaned: filters.orphaned,
      sort: filters.sort,
      dir: filters.dir,
      limit: PAGE_SIZE,
      offset,
    }),
    [
      filters.author,
      filters.dir,
      filters.kind,
      filters.minScore,
      filters.orphaned,
      filters.origin,
      filters.sort,
      filters.subreddit,
      filters.tag,
      offset,
    ],
  );

  const list = usePosts(listParams);
  const search = useSearchPosts({ ...listParams, q: filters.q });

  const active = isSearch ? search : list;
  const items = isSearch ? search.data?.items ?? [] : list.data?.items ?? [];
  const total = isSearch ? search.data?.total ?? 0 : list.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const clampedPage = total > 0 ? Math.min(page, totalPages) : page;
  const isPageOutOfRange = page !== clampedPage;
  const isRefreshingClampedPage = active.isFetching && active.isPlaceholderData && total > 0;
  const canGoPrev = page > 1;
  const canGoNext = page < totalPages;

  useEffect(() => {
    if (!isPageOutOfRange) return;
    void navigate({
      replace: true,
      search: (prev: BrowseFilters) => ({
        ...prev,
        page: clampedPage > 1 ? clampedPage : undefined,
      }),
    });
  }, [clampedPage, isPageOutOfRange, navigate]);

  const onFilterChange = (next: BrowseFilters): void => {
    void navigate({
      search: () => ({
        ...next,
        page: undefined,
      }),
    });
  };

  const onSearch = (q: string): void => {
    void navigate({
      search: (prev: BrowseFilters) => ({
        ...prev,
        q: q || undefined,
        page: undefined,
      }),
    });
  };

  const onPageChange = (nextPage: number): void => {
    void navigate({
      search: (prev: BrowseFilters) => ({
        ...prev,
        page: nextPage > 1 ? nextPage : undefined,
      }),
    });
  };

  return (
    <div className="flex flex-col gap-4 md:flex-row">
      <FilterPanel
        filters={filters}
        onChange={onFilterChange}
        availableSubreddits={subreddits}
        availableTags={tags.data?.items.map((t) => t.name) ?? []}
      />

      <section className="flex-1">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex-1">
            <SearchBar value={filters.q ?? ""} onSearch={onSearch} />
          </div>
          <div className="text-xs text-[var(--color-muted-foreground)]">
            {active.isLoading
              ? "Loading…"
              : isSearch
                ? `${total.toLocaleString()} match${total === 1 ? "" : "es"}`
                : `${total.toLocaleString()} total`}
          </div>
        </div>

        {active.isLoading || isPageOutOfRange || isRefreshingClampedPage ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : active.isError ? (
          <ErrorState error={active.error} onRetry={() => active.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            title={isSearch ? "No results" : "Nothing matches those filters"}
            description={
              isSearch
                ? "Try a different search or clear filters."
                : "Adjust the sidebar or clear filters."
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            <PostList
              items={items}
              snippetBy={
                isSearch
                  ? (item) =>
                      "snippet" in item ? (item as { snippet?: string }).snippet : undefined
                  : undefined
              }
            />
            {total > PAGE_SIZE ? (
              <div className="flex items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-xs">
                <span className="text-[var(--color-muted-foreground)]">
                  Page {page} of {totalPages}
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canGoPrev}
                    onClick={() => onPageChange(page - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canGoNext}
                    onClick={() => onPageChange(page + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
