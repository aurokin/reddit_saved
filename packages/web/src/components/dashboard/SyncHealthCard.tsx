import { useSyncStream } from "@/hooks/queries";
import { formatRelative } from "@/lib/utils";
import type { ContentOrigin, SyncRunSummary } from "@/types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

const ORIGIN_LABELS: Record<ContentOrigin, string> = {
  saved: "Saved",
  upvoted: "Upvoted",
  submitted: "Posted",
  commented: "Comments",
};

function statusVariant(status: string): "secondary" | "destructive" | "outline" {
  if (status === "complete") return "secondary";
  if (status === "errored") return "destructive";
  return "outline";
}

export function SyncHealthCard({
  origin,
  summary,
  activeCount,
}: {
  origin: ContentOrigin;
  summary: SyncRunSummary | undefined;
  activeCount: number | undefined;
}) {
  const stream = useSyncStream();
  const lastRun = summary?.lastRun ?? null;
  // Saturation means orphan detection hit Reddit's ~1000-item window; no full
  // sync means orphan state has never been established at all.
  const warn = lastRun !== null && (lastRun.saturated || summary?.lastCompleteFullAt === null);

  return (
    <div
      className={`flex flex-col gap-2 rounded-lg border p-3 text-sm ${
        warn ? "border-amber-500/60" : "border-[var(--color-border)]"
      } bg-[var(--color-card)]`}
      data-testid={`sync-health-${origin}`}
    >
      <div className="flex items-center justify-between">
        <span className="font-medium">{ORIGIN_LABELS[origin]}</span>
        {lastRun ? (
          <Badge variant={statusVariant(lastRun.status)} className="text-[10px] uppercase">
            {lastRun.status}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] uppercase">
            never
          </Badge>
        )}
      </div>
      <div className="text-xs text-[var(--color-muted-foreground)]">
        {lastRun ? (
          <>
            {lastRun.fetched} fetched · {lastRun.mode} ·{" "}
            {formatRelative(Math.floor(lastRun.finishedAt / 1000))}
          </>
        ) : (
          "No sync recorded yet"
        )}
      </div>
      <div className="text-xs text-[var(--color-muted-foreground)]">
        {activeCount !== undefined ? `${activeCount} in archive` : "—"}
      </div>
      {warn ? (
        <div className="text-xs text-amber-600 dark:text-amber-400">
          {lastRun?.saturated
            ? "Orphan detection saturated — run a full sync"
            : "No complete full sync yet"}
        </div>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        className="mt-auto"
        disabled={stream.isRunning}
        onClick={() => stream.start(origin, false)}
        data-testid={`sync-start-${origin}`}
      >
        Sync
      </Button>
    </div>
  );
}
