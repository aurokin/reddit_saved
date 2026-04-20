import { ErrorState } from "@/components/ErrorState";
import { SyncStatus } from "@/components/SyncStatus";
import { TagManager } from "@/components/TagManager";
import { Button } from "@/components/ui/button";
import {
  downloadExport,
  useAuthStatus,
  useDisconnectSessionMutation,
  useLogoutMutation,
  useSessionStatus,
  useSyncStatus,
} from "@/hooks/queries";
import { Link } from "@tanstack/react-router";
import { Download, LogOut, Plug, Unplug } from "lucide-react";
import { useState } from "react";

type ExportFormat = "json" | "csv" | "markdown";

export function SettingsPage() {
  const auth = useAuthStatus();
  const session = useSessionStatus();
  const sync = useSyncStatus();
  const logout = useLogoutMutation();
  const disconnect = useDisconnectSessionMutation();
  const [exportErr, setExportErr] = useState<unknown>(null);
  const [exportPending, setExportPending] = useState<ExportFormat | null>(null);

  const doExport = async (format: ExportFormat): Promise<void> => {
    setExportErr(null);
    setExportPending(format);
    try {
      await downloadExport(format);
    } catch (err) {
      setExportErr(err);
    } finally {
      setExportPending(null);
    }
  };

  return (
    <div className="flex flex-col gap-8" data-testid="settings-page">
      <section className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Manage your Reddit account, sync state, tags, and exports.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Reddit account</h2>
        {auth.isLoading ? (
          <p className="text-sm">Checking status…</p>
        ) : auth.data?.authenticated && auth.data.mode === "session" ? (
          <div className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
            <div className="flex flex-col gap-1">
              <p className="text-sm">
                <Plug className="mr-1 inline h-4 w-4" />
                Connected as <span className="font-medium">{auth.data.username ?? "unknown"}</span>{" "}
                via the companion extension.
              </p>
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Cookies last refreshed{" "}
                {formatRelative(auth.data.capturedAt ?? session.data?.capturedAt)}.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => disconnect.mutate()}
              disabled={disconnect.isPending}
              data-testid="disconnect-button"
            >
              <Unplug className="h-4 w-4" /> Disconnect
            </Button>
          </div>
        ) : auth.data?.authenticated ? (
          <div className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
            <div>
              <p className="text-sm">
                Signed in as{" "}
                <span className="font-medium">
                  {auth.data.username ?? (auth.data.testMode ? "test-mode" : "unknown")}
                </span>{" "}
                via OAuth.
              </p>
              {auth.data.testMode ? (
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  Running in TEST_MODE. OAuth and Reddit writes are stubbed.
                </p>
              ) : null}
            </div>
            <Button
              variant="outline"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              data-testid="logout-button"
            >
              <LogOut className="h-4 w-4" /> Sign out
            </Button>
          </div>
        ) : session.data?.blocked ? (
          <div className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
            <p className="text-sm">
              Extension sync is disconnected. Use Reconnect to allow the extension to hand your
              reddit.com session back to the app.
            </p>
            <Button asChild>
              <Link to="/login">Reconnect</Link>
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
            <p className="text-sm">
              Not connected. Install the companion extension to forward your reddit.com session.
            </p>
            <Button asChild>
              <Link to="/login">Connect</Link>
            </Button>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Sync</h2>
        <SyncStatus />
        {sync.data ? (
          <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
            <Stat label="Posts" value={sync.data.stats.totalPosts} />
            <Stat label="Comments" value={sync.data.stats.totalComments} />
            <Stat label="Orphaned" value={sync.data.stats.orphanedCount} />
            <Stat label="Subreddits" value={sync.data.stats.subredditCounts.length} />
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Export</h2>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Download a copy of your archive in JSON, CSV, or Markdown.
        </p>
        <div className="flex gap-2">
          {(["json", "csv", "markdown"] as ExportFormat[]).map((fmt) => (
            <Button
              key={fmt}
              variant="outline"
              disabled={exportPending !== null}
              onClick={() => void doExport(fmt)}
              data-testid={`export-${fmt}`}
            >
              <Download className="h-4 w-4" />{" "}
              {exportPending === fmt ? "Exporting…" : fmt.toUpperCase()}
            </Button>
          ))}
        </div>
        {exportErr ? <ErrorState error={exportErr} /> : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Tags</h2>
        <TagManager />
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-3">
      <div className="text-[var(--color-muted-foreground)]">{label}</div>
      <div className="text-lg font-semibold">{value.toLocaleString()}</div>
    </div>
  );
}

function formatRelative(ms: number | undefined): string {
  if (!ms) return "unknown";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} hr ago`;
  return `${Math.round(diff / 86_400_000)} days ago`;
}
