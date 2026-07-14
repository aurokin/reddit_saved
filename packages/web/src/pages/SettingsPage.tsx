import { ErrorState } from "@/components/ErrorState";
import { SyncControls } from "@/components/SyncControls";
import { SyncStatus } from "@/components/SyncStatus";
import { TagManager } from "@/components/TagManager";
import { Button } from "@/components/ui/button";
import {
  downloadExport,
  useAuthStatus,
  useDisconnectSessionMutation,
  useJobRuns,
  useLogoutMutation,
  useSessionStatus,
  useSyncRuns,
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
  const runs = useSyncRuns();
  const jobs = useJobRuns();
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
        <p className="text-sm text-muted-foreground">
          Manage your Reddit account, sync state, tags, and exports.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Reddit account</h2>
        <p className="text-sm text-muted-foreground">
          Reddit Cached signs in with the same browser session you use on reddit.com, forwarded by
          the companion extension — no password is stored here. Reddit occasionally expires that
          session; when it does, just browse reddit.com while signed in and the extension
          re-forwards it automatically. If you disconnect on purpose, a Reconnect button appears
          here.
        </p>
        {auth.isLoading ? (
          <p className="text-sm">Checking status…</p>
        ) : auth.data?.authenticated && auth.data.mode === "session" ? (
          <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
            <div className="flex flex-col gap-1">
              <p className="text-sm">
                <Plug className="mr-1 inline h-4 w-4" />
                Connected as <span className="font-medium">{auth.data.username ?? "unknown"}</span>{" "}
                via the companion extension.
              </p>
              <p className="text-xs text-muted-foreground">
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
          <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
            <div>
              <p className="text-sm">
                Signed in as{" "}
                <span className="font-medium">
                  {auth.data.username ?? (auth.data.testMode ? "test-mode" : "unknown")}
                </span>{" "}
                via OAuth.
              </p>
              {auth.data.testMode ? (
                <p className="text-xs text-muted-foreground">
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
          <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
            <p className="text-sm">
              Extension sync is disconnected, so scheduled syncs are paused. Your archive is safe —
              use Reconnect to let the extension hand your reddit.com session back to the app.
            </p>
            <Button asChild>
              <Link to="/login">Reconnect</Link>
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
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
        <SyncStatus showControls={false} />
        <SyncControls />
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
        <h2 className="text-base font-semibold">Sync history</h2>
        {runs.data && runs.data.items.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm" data-testid="sync-runs-table">
              <thead className="bg-muted text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Origin</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Mode</th>
                  <th className="px-3 py-2">Fetched</th>
                  <th className="px-3 py-2">Finished</th>
                  <th className="px-3 py-2">Last full sync</th>
                </tr>
              </thead>
              <tbody>
                {runs.data.items.map((run) => (
                  <tr key={run.origin} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{run.origin}</td>
                    <td className="px-3 py-2">
                      {run.lastRun?.status ?? "—"}
                      {run.lastRun?.saturated ? " (saturated)" : ""}
                    </td>
                    <td className="px-3 py-2">{run.lastRun?.mode ?? "—"}</td>
                    <td className="px-3 py-2">{run.lastRun?.fetched ?? "—"}</td>
                    <td className="px-3 py-2">{formatRelative(run.lastRun?.finishedAt)}</td>
                    <td className="px-3 py-2">
                      {formatRelative(run.lastCompleteFullAt ?? undefined)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No sync runs recorded yet.</p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Scheduled jobs</h2>
        <p className="text-sm text-muted-foreground">
          Pipeline runs from <code>reddit-cached jobs run</code> (manual or launchd).
        </p>
        {jobs.data && jobs.data.items.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm" data-testid="job-runs-table">
              <thead className="bg-muted text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Started</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Trigger</th>
                  <th className="px-3 py-2">Steps</th>
                </tr>
              </thead>
              <tbody>
                {jobs.data.items.map((run) => (
                  <tr key={run.id} className="border-t border-border">
                    <td className="px-3 py-2">{formatRelative(run.startedAt)}</td>
                    <td className="px-3 py-2">{run.status}</td>
                    <td className="px-3 py-2">{run.trigger}</td>
                    <td className="px-3 py-2">
                      {run.steps
                        .map((s) => `${s.step}${s.ok ? "" : " ✗"}${s.skipped ? " (skipped)" : ""}`)
                        .join(", ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No pipeline runs yet. Install the hourly agent with{" "}
            <code>reddit-cached jobs install-launchd</code>.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Export</h2>
        <p className="text-sm text-muted-foreground">
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
    <div className="rounded-md border border-border bg-card p-3">
      <div className="text-muted-foreground">{label}</div>
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
