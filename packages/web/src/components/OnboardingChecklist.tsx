import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuthStatus, useJobRuns, useSyncStatus, useSyncStream } from "@/hooks/queries";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Circle } from "lucide-react";
import type { ReactNode } from "react";

/**
 * First-run checklist shown instead of the dashboard while the archive is
 * empty. Every step's done-state is derived live from existing queries —
 * there is no stored wizard state.
 */
export function OnboardingChecklist() {
  const auth = useAuthStatus();
  const sync = useSyncStatus();
  const jobs = useJobRuns();
  const stream = useSyncStream();

  const stats = sync.data?.stats;
  const authenticated = auth.data?.authenticated === true;
  const hasData = !!stats && stats.totalPosts + stats.totalComments > 0;
  const hasJobRuns = (jobs.data?.items?.length ?? 0) > 0;

  return (
    <Card className="flex flex-col gap-4 p-6" data-testid="onboarding">
      <div>
        <h2 className="text-lg font-semibold">Set up your archive</h2>
        <p className="text-sm text-muted-foreground">
          Your archive is empty. Work through these steps once — after that, everything stays fresh
          in the background.
        </p>
      </div>

      <Step done={authenticated} title="Connect Reddit" testId="onboarding-step-connect">
        {authenticated ? (
          <>Connected{auth.data?.username ? ` as ${auth.data.username}` : ""}.</>
        ) : (
          <>
            Forward your reddit.com session with the companion extension.{" "}
            <Link
              to="/login"
              className="text-primary hover:underline"
              data-testid="onboarding-login"
            >
              Connect →
            </Link>
          </>
        )}
      </Step>

      <Step done={hasData} title="Run your first sync" testId="onboarding-step-sync">
        Fetch your saved posts into the local archive.{" "}
        <Button
          size="sm"
          variant="outline"
          disabled={stream.isRunning || !authenticated}
          onClick={() => stream.start("saved", true)}
          data-testid="onboarding-sync"
        >
          Sync saved posts
        </Button>
        {authenticated ? null : (
          <span className="mt-1 block">Connect Reddit first — this enables once you're in.</span>
        )}
      </Step>

      <Step done={hasJobRuns} title="Schedule hourly syncs" testId="onboarding-step-schedule">
        {hasJobRuns ? (
          "A background sync has run on this machine."
        ) : (
          <>
            Install the background job so the archive updates itself:
            <span className="mt-1 block">
              <code className="rounded bg-muted px-1.5 py-0.5">
                reddit-cached jobs install-launchd
              </code>{" "}
              (macOS) ·{" "}
              <code className="rounded bg-muted px-1.5 py-0.5">
                reddit-cached jobs install-systemd
              </code>{" "}
              (Linux)
            </span>
          </>
        )}
      </Step>

      {/* Backup state isn't exposed to the web app, so this is a plain hint
          rather than a checklist step with a done-circle it could never fill. */}
      <p className="text-sm text-muted-foreground" data-testid="onboarding-step-backup">
        Optional: mirror the archive into a git repo with{" "}
        <code className="rounded bg-muted px-1.5 py-0.5">
          reddit-cached backup init --repo ~/backups/reddit-cached
        </code>{" "}
        — after that, the scheduled job keeps it in sync.
      </p>
    </Card>
  );
}

function Step({
  done,
  title,
  testId,
  children,
}: {
  done: boolean;
  title: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3" data-testid={testId} data-done={done || undefined}>
      {done ? (
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
      ) : (
        <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
      )}
      <div className={done ? "text-muted-foreground" : undefined}>
        <p className="text-sm font-medium">{title}</p>
        <div className="text-sm text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}
