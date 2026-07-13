import { useSyncStream } from "@/hooks/queries";
import type { ContentOrigin } from "@/types";
import { useState } from "react";
import { Button } from "./ui/button";

const ORIGINS: Array<{ value: ContentOrigin; label: string }> = [
  { value: "saved", label: "Saved" },
  { value: "upvoted", label: "Upvoted" },
  { value: "submitted", label: "Posted" },
  { value: "commented", label: "Comments" },
];

/** Full sync controls: origin picker, full toggle, start/cancel, plus
 *  thread-context capture. */
export function SyncControls() {
  const stream = useSyncStream();
  const [origin, setOrigin] = useState<ContentOrigin>("saved");
  const [full, setFull] = useState(false);

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 text-sm"
      data-testid="sync-controls"
    >
      <select
        value={origin}
        onChange={(e) => setOrigin(e.target.value as ContentOrigin)}
        disabled={stream.isRunning}
        className="h-9 rounded-md border border-[var(--color-input)] bg-transparent px-2 text-sm"
        data-testid="sync-controls-origin"
        aria-label="Sync origin"
      >
        {ORIGINS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1.5 text-xs">
        <input
          type="checkbox"
          checked={full}
          onChange={(e) => setFull(e.target.checked)}
          disabled={stream.isRunning}
          data-testid="sync-controls-full"
        />
        Full sync
      </label>
      <Button
        size="sm"
        disabled={stream.isRunning}
        onClick={() => stream.start(origin, full)}
        data-testid="sync-controls-start"
      >
        Start
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={stream.isRunning}
        onClick={() => stream.start("context", false)}
        data-testid="sync-controls-context"
      >
        Fetch context
      </Button>
      {stream.isRunning ? (
        <Button size="sm" variant="destructive" onClick={() => void stream.cancel()}>
          Cancel
        </Button>
      ) : null}
      {stream.latest ? (
        <span className="text-xs text-[var(--color-muted-foreground)]">
          {stream.latest.phase}
          {stream.latest.fetched > 0 ? ` (${stream.latest.fetched})` : ""}
        </span>
      ) : null}
      {stream.error ? (
        <span className="text-xs text-[var(--color-destructive)]">{stream.error}</span>
      ) : null}
    </div>
  );
}
