import type { DbStats } from "@/types";

/** Thread-context coverage: context rows captured vs. saved items in the archive. */
export function ContextProgressCard({ stats }: { stats: DbStats | undefined }) {
  const captured = stats?.contextCount;
  const savedCount = stats?.activeCountByOrigin.saved;

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4"
      data-testid="context-progress-card"
    >
      <h3 className="text-sm font-semibold">Thread context</h3>
      {captured !== undefined && savedCount !== undefined ? (
        <>
          <div className="text-2xl font-semibold">{captured}</div>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            context rows captured around {savedCount} saved item{savedCount === 1 ? "" : "s"}. Runs
            incrementally with each scheduled job.
          </p>
        </>
      ) : (
        <p className="text-sm text-[var(--color-muted-foreground)]">—</p>
      )}
    </div>
  );
}
