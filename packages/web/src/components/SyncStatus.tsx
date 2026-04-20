import { Loader2, RefreshCw } from "lucide-react";
import { useSyncStatus, useSyncStream } from "@/hooks/queries";
import { Button } from "./ui/button";

export function SyncStatus({ showControls = true }: { showControls?: boolean }) {
  const { data, isLoading } = useSyncStatus();
  const stream = useSyncStream();

  const running = data?.isRunning || stream.isRunning;
  const last = data?.lastSyncTime;
  const lastStr = last ? new Date(last).toLocaleString() : "never";

  return (
    <div
      className="flex items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-sm"
      data-testid="sync-status"
    >
      {running || isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-[var(--color-primary)]" />
      ) : (
        <RefreshCw className="h-4 w-4 text-[var(--color-muted-foreground)]" />
      )}
      <div className="flex flex-col gap-0.5 text-xs">
        <span className="text-[var(--color-muted-foreground)]">Last sync</span>
        <span className="font-medium">{lastStr}</span>
      </div>
      {stream.latest ? (
        <span className="ml-2 rounded bg-[var(--color-muted)] px-2 py-0.5 text-xs">
          {stream.latest.phase} {stream.latest.fetched > 0 ? `(${stream.latest.fetched})` : ""}
        </span>
      ) : null}
      {stream.error ? (
        <span className="text-xs text-[var(--color-destructive)]">{stream.error}</span>
      ) : null}
      {showControls ? (
        <div className="ml-auto flex gap-1">
          <Button
            size="sm"
            variant="outline"
            disabled={running}
            onClick={() => stream.start("saved", false)}
            data-testid="sync-now"
          >
            Sync now
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={running}
            onClick={() => stream.start("saved", true)}
          >
            Full sync
          </Button>
          {running ? (
            <Button size="sm" variant="destructive" onClick={() => stream.cancel()}>
              Cancel
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
