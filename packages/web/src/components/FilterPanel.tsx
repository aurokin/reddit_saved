import { X } from "lucide-react";
import type { ContentOrigin } from "@/types";
import type { BrowseFilters } from "@/types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const ORIGINS: Array<{ value: ContentOrigin; label: string }> = [
  { value: "saved", label: "Saved" },
  { value: "upvoted", label: "Upvoted" },
  { value: "submitted", label: "Submitted" },
  { value: "commented", label: "Commented" },
];

export function FilterPanel({
  filters,
  onChange,
  availableSubreddits = [],
  availableTags = [],
}: {
  filters: BrowseFilters;
  onChange: (next: BrowseFilters) => void;
  availableSubreddits?: string[];
  availableTags?: string[];
}) {
  const setField = <K extends keyof BrowseFilters>(key: K, val: BrowseFilters[K]): void => {
    const next = { ...filters, [key]: val };
    if (val === "" || val === undefined || val === null) delete next[key];
    onChange(next);
  };

  const hasActive =
    !!filters.subreddit ||
    !!filters.author ||
    !!filters.tag ||
    !!filters.origin ||
    !!filters.kind ||
    filters.minScore !== undefined ||
    filters.orphaned !== undefined;

  const clearFilters = (): void => {
    const {
      subreddit: _subreddit,
      author: _author,
      tag: _tag,
      origin: _origin,
      kind: _kind,
      minScore: _minScore,
      orphaned: _orphaned,
      ...rest
    } = filters;
    onChange(rest);
  };

  return (
    <aside
      className="flex w-full max-w-xs flex-col gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4"
      data-testid="filter-panel"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Filters</h2>
        {hasActive ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            data-testid="clear-filters"
          >
            <X className="h-3.5 w-3.5" /> Clear
          </Button>
        ) : null}
      </div>

      <label className="flex flex-col gap-1 text-xs font-medium">
        Subreddit
        <Input
          list="subreddit-options"
          value={filters.subreddit ?? ""}
          onChange={(e) => setField("subreddit", e.currentTarget.value || undefined)}
          placeholder="e.g. typescript"
          data-testid="filter-subreddit"
        />
        <datalist id="subreddit-options">
          {availableSubreddits.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </label>

      <label className="flex flex-col gap-1 text-xs font-medium">
        Author
        <Input
          value={filters.author ?? ""}
          onChange={(e) => setField("author", e.currentTarget.value || undefined)}
          placeholder="e.g. alice"
          data-testid="filter-author"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs font-medium">
        Tag
        <Input
          list="tag-options"
          value={filters.tag ?? ""}
          onChange={(e) => setField("tag", e.currentTarget.value || undefined)}
          placeholder="e.g. read-later"
          data-testid="filter-tag"
        />
        <datalist id="tag-options">
          {availableTags.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </label>

      <label className="flex flex-col gap-1 text-xs font-medium">
        Min score
        <Input
          type="number"
          value={filters.minScore ?? ""}
          onChange={(e) =>
            setField("minScore", e.currentTarget.value ? Number(e.currentTarget.value) : undefined)
          }
          placeholder="0"
          data-testid="filter-min-score"
        />
      </label>

      <fieldset className="flex flex-col gap-2 text-xs">
        <legend className="mb-1 font-medium">Origin</legend>
        <div className="flex flex-wrap gap-1">
          {ORIGINS.map((o) => (
            <Button
              key={o.value}
              variant={filters.origin === o.value ? "default" : "outline"}
              size="sm"
              onClick={() =>
                setField("origin", filters.origin === o.value ? undefined : o.value)
              }
            >
              {o.label}
            </Button>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2 text-xs">
        <legend className="mb-1 font-medium">Type</legend>
        <div className="flex gap-1">
          <Button
            variant={filters.kind === "t3" ? "default" : "outline"}
            size="sm"
            onClick={() => setField("kind", filters.kind === "t3" ? undefined : "t3")}
          >
            Posts
          </Button>
          <Button
            variant={filters.kind === "t1" ? "default" : "outline"}
            size="sm"
            onClick={() => setField("kind", filters.kind === "t1" ? undefined : "t1")}
          >
            Comments
          </Button>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2 text-xs">
        <legend className="mb-1 font-medium">Status</legend>
        <div className="flex gap-1">
          <Button
            variant={filters.orphaned === true ? "default" : "outline"}
            size="sm"
            onClick={() => setField("orphaned", filters.orphaned === true ? undefined : true)}
            data-testid="filter-orphaned"
          >
            Orphaned only
          </Button>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2 text-xs">
        <legend className="mb-1 font-medium">Sort</legend>
        <div className="flex gap-1">
          <Button
            variant={(filters.sort ?? "created") === "created" ? "default" : "outline"}
            size="sm"
            onClick={() => setField("sort", "created")}
          >
            Newest
          </Button>
          <Button
            variant={filters.sort === "score" ? "default" : "outline"}
            size="sm"
            onClick={() => setField("sort", "score")}
          >
            Top score
          </Button>
        </div>
      </fieldset>
    </aside>
  );
}
