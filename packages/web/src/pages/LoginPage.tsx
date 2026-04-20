import { ErrorState } from "@/components/ErrorState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useAuthStatus,
  useLoginMutation,
  useReconnectSessionMutation,
  useSessionStatus,
} from "@/hooks/queries";
import { Link, useNavigate } from "@tanstack/react-router";
import { Chrome, ExternalLink, Loader2, Plug } from "lucide-react";
import { useEffect, useState } from "react";

export function LoginPage() {
  const navigate = useNavigate();
  const auth = useAuthStatus();
  const session = useSessionStatus();
  const reconnect = useReconnectSessionMutation();
  const login = useLoginMutation();
  const [showOAuth, setShowOAuth] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null);

  useEffect(() => {
    if (auth.data?.authenticated) {
      void navigate({ to: "/" });
    }
  }, [auth.data?.authenticated, navigate]);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const res = await login.mutateAsync({
      clientId: clientId.trim() || undefined,
      clientSecret: clientSecret.trim() || undefined,
    });
    if (res.authorizeUrl) {
      setAuthorizeUrl(res.authorizeUrl);
      window.open(res.authorizeUrl, "_blank", "noopener");
    }
  };

  if (auth.data?.authenticated) {
    return (
      <div className="mx-auto max-w-md text-center text-sm">
        <p>You are already signed in. Redirecting…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4" data-testid="login-page">
      <header>
        <h1 className="text-xl font-semibold">Connect to Reddit</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Reddit no longer accepts new API app registrations. Install the companion browser
          extension instead — it forwards your existing reddit.com session to this app, on your
          machine only.
        </p>
      </header>

      <section className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Plug className="h-4 w-4" /> Step 1 — Install the extension
        </div>
        <ol className="ml-5 list-decimal text-xs text-[var(--color-muted-foreground)]">
          <li>
            Open <code>packages/extension</code> in this repo.
          </li>
          <li>
            <strong>Chrome:</strong> visit <code>chrome://extensions</code>, enable Developer mode,
            click <em>Load unpacked</em>, pick the folder.
          </li>
          <li>
            <strong>Firefox:</strong> visit <code>about:debugging</code>, click
            <em> This Firefox</em>, run <code>npm run build</code> in{" "}
            <code>packages/extension</code>, then <em>Load Temporary Add-on</em> and pick{" "}
            <code>packages/extension/dist/firefox/manifest.json</code>.
          </li>
          <li>Make sure you're already logged into reddit.com in this browser.</li>
        </ol>

        <div className="flex items-center gap-2 text-sm font-medium">
          <Chrome className="h-4 w-4" /> Step 2 — Wait for the handshake
        </div>
        <p className="text-xs text-[var(--color-muted-foreground)]">
          Set the extension’s local app URL if you are not using the default server port. It syncs
          on install, on browser startup, when reddit.com cookies change, and every 30 minutes.
        </p>

        <div className="rounded-md border border-dashed border-[var(--color-border)] p-3 text-xs">
          {session.isLoading ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…
            </span>
          ) : session.data?.connected ? (
            <span>
              ✓ Connected as <span className="font-medium">{session.data.username}</span>.
              Redirecting…
            </span>
          ) : session.data?.blocked ? (
            <div className="flex flex-col gap-3">
              <span>
                Extension sync is currently disconnected. Reconnect here, then click
                <span className="font-medium"> Sync now</span> in the extension popup if you want to
                restore the session immediately.
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => reconnect.mutate()}
                disabled={reconnect.isPending}
              >
                {reconnect.isPending ? "Reconnecting…" : "Reconnect extension sync"}
              </Button>
              {reconnect.error ? <ErrorState error={reconnect.error} /> : null}
            </div>
          ) : (
            <span className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for the extension…
            </span>
          )}
        </div>
      </section>

      <details
        className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 text-sm"
        open={showOAuth}
        onToggle={(e) => setShowOAuth((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer text-xs text-[var(--color-muted-foreground)]">
          Have a registered Reddit OAuth app? Use that instead
        </summary>

        {authorizeUrl ? (
          <div className="mt-3 flex flex-col gap-3">
            <p className="text-sm">
              A browser tab has been opened. After you approve the app on Reddit, this page will
              update automatically.
            </p>
            <Button asChild variant="outline">
              <a href={authorizeUrl} target="_blank" rel="noreferrer noopener">
                <ExternalLink className="h-4 w-4" /> Reopen authorize URL
              </a>
            </Button>
            <div className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for Reddit…
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-3 flex flex-col gap-3">
            <label htmlFor="reddit-client-id" className="flex flex-col gap-1 text-xs">
              Reddit client ID (optional — uses env if unset)
              <Input
                id="reddit-client-id"
                value={clientId}
                onChange={(e) => setClientId(e.currentTarget.value)}
                placeholder="REDDIT_CLIENT_ID"
                autoComplete="off"
              />
            </label>
            <label htmlFor="reddit-client-secret" className="flex flex-col gap-1 text-xs">
              Client secret (optional)
              <Input
                id="reddit-client-secret"
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.currentTarget.value)}
                placeholder="REDDIT_CLIENT_SECRET"
                autoComplete="off"
              />
            </label>
            <Button type="submit" disabled={login.isPending} data-testid="login-submit">
              {login.isPending ? "Starting…" : "Start OAuth sign-in"}
            </Button>
          </form>
        )}

        {login.error ? <ErrorState error={login.error} /> : null}
      </details>

      <p className="text-center text-xs">
        <Link to="/" className="text-[var(--color-muted-foreground)] hover:underline">
          ← Back to home
        </Link>
      </p>
    </div>
  );
}
