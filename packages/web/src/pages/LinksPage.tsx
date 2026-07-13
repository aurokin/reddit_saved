import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { useLinkSearch, useTopLinks } from "@/hooks/queries";
import { formatRelative } from "@/lib/utils";
import type { LinkSearchRow } from "@/types";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, ExternalLink, Link2 } from "lucide-react";
import { useMemo, useState } from "react";

const WINDOWS: Array<{ value: string; label: string; seconds: number | null }> = [
  { value: "7d", label: "7 days", seconds: 7 * 86_400 },
  { value: "30d", label: "30 days", seconds: 30 * 86_400 },
  { value: "90d", label: "90 days", seconds: 90 * 86_400 },
  { value: "all", label: "All time", seconds: null },
];

export function LinksPage() {
  const [window, setWindow] = useState("30d");
  const [excludeReddit, setExcludeReddit] = useState(true);
  const [q, setQ] = useState("");

  // Rounded to the hour so query keys stay stable across renders.
  const since = useMemo(() => {
    const seconds = WINDOWS.find((w) => w.value === window)?.seconds ?? null;
    if (seconds === null) return undefined;
    return Math.floor(Date.now() / 3_600_000) * 3600 - seconds;
  }, [window]);

  const top = useTopLinks({ since, excludeReddit, limit: 50 });
  const search = useLinkSearch({ q: q.trim() || undefined, limit: 100 });
  const searching = q.trim().length > 0;

  return (
    <div className="flex flex-col gap-4" data-testid="links-page">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Links</h1>
        <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search URLs…"
            className="h-9 w-56 rounded-md border border-[var(--color-input)] bg-transparent px-2 text-sm"
            data-testid="links-search"
          />
          <select
            value={window}
            onChange={(e) => setWindow(e.target.value)}
            disabled={searching}
            className="h-9 rounded-md border border-[var(--color-input)] bg-transparent px-2 text-sm"
            data-testid="links-window"
            aria-label="Time window"
          >
            {WINDOWS.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={excludeReddit}
              onChange={(e) => setExcludeReddit(e.target.checked)}
              disabled={searching}
              data-testid="links-exclude-reddit"
            />
            Hide reddit links
          </label>
        </div>
      </div>

      {searching ? (
        <SearchResults rows={search.data?.items} isLoading={search.isLoading} />
      ) : top.isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : top.isError ? (
        <ErrorState error={top.error} onRetry={() => top.refetch()} />
      ) : top.data && top.data.items.length > 0 ? (
        <div className="flex flex-col divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]">
          {top.data.items.map((link) => (
            <TopLinkRow key={link.canonical_url} link={link} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Link2 className="h-8 w-8" />}
          title="No links in this window"
          description="Outbound links are indexed automatically as posts sync."
        />
      )}
    </div>
  );
}

function TopLinkRow({
  link,
}: {
  link: {
    canonical_url: string;
    host: string;
    postCount: number;
    occurrenceCount: number;
    lastSeen: number;
    sampleUrl: string;
  };
}) {
  const [expanded, setExpanded] = useState(false);
  const referencing = useLinkSearch({ q: expanded ? link.canonical_url : undefined, limit: 50 });

  return (
    <div className="flex flex-col" data-testid="link-row">
      <div className="flex items-center gap-3 px-3 py-2 text-sm">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          aria-label={expanded ? "Collapse" : "Expand"}
          data-testid="link-expand"
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <span className="w-40 shrink-0 truncate text-xs text-[var(--color-muted-foreground)]">
          {link.host}
        </span>
        <a
          href={link.sampleUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 flex-1 truncate hover:underline"
          title={link.canonical_url}
        >
          {link.canonical_url}
          <ExternalLink className="ml-1 inline h-3 w-3 text-[var(--color-muted-foreground)]" />
        </a>
        <span className="shrink-0 text-xs text-[var(--color-muted-foreground)]">
          {link.postCount} post{link.postCount === 1 ? "" : "s"} · {link.occurrenceCount} occ ·{" "}
          {formatRelative(link.lastSeen)}
        </span>
      </div>
      {expanded ? (
        <div className="border-t border-[var(--color-border)] bg-[var(--color-background)] px-10 py-2">
          {referencing.isLoading ? (
            <Skeleton className="h-6 w-full" />
          ) : referencing.data && referencing.data.items.length > 0 ? (
            <ul className="flex flex-col gap-1 text-sm">
              {referencing.data.items.map((row) => (
                <li key={`${row.post_id}-${row.source}-${row.position}`} className="truncate">
                  <Link to="/post/$id" params={{ id: row.post_id }} className="hover:underline">
                    {row.title ?? row.post_id}
                  </Link>
                  <span className="ml-1 text-xs text-[var(--color-muted-foreground)]">
                    r/{row.subreddit} · {row.source}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-[var(--color-muted-foreground)]">No referencing posts.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function SearchResults({
  rows,
  isLoading,
}: {
  rows: LinkSearchRow[] | undefined;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  if (!rows || rows.length === 0) {
    return (
      <EmptyState
        icon={<Link2 className="h-8 w-8" />}
        title="No matching links"
        description="Try a shorter substring — the search matches raw and canonical URLs."
      />
    );
  }
  return (
    <div className="flex flex-col divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]">
      {rows.map((row) => (
        <div
          key={`${row.post_id}-${row.source}-${row.position}`}
          className="flex items-center gap-3 px-3 py-2 text-sm"
          data-testid="link-search-row"
        >
          <span className="w-40 shrink-0 truncate text-xs text-[var(--color-muted-foreground)]">
            {row.host}
          </span>
          <a
            href={row.url}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 flex-1 truncate hover:underline"
          >
            {row.canonical_url}
            <ExternalLink className="ml-1 inline h-3 w-3 text-[var(--color-muted-foreground)]" />
          </a>
          <Link
            to="/post/$id"
            params={{ id: row.post_id }}
            className="shrink-0 text-xs text-[var(--color-muted-foreground)] hover:underline"
          >
            {row.title ? `${row.title.slice(0, 40)}…` : row.post_id} →
          </Link>
        </div>
      ))}
    </div>
  );
}
