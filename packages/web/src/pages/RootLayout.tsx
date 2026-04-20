import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Bookmark, Settings } from "lucide-react";
import { type ReactNode, Suspense } from "react";
import { DarkModeToggle } from "@/components/DarkModeToggle";
import { ErrorState } from "@/components/ErrorState";
import { SearchBar } from "@/components/SearchBar";
import { SyncStatus } from "@/components/SyncStatus";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Button } from "@/components/ui/button";
import type { BrowseFilters } from "@/types";

export function RootLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const onSearch = (q: string): void => {
    if (pathname.startsWith("/browse")) {
      void navigate({
        to: "/browse",
        search: (prev: BrowseFilters) => ({
          ...prev,
          q: q || undefined,
          page: undefined,
        }),
      });
      return;
    }

    if (!q) return;
    void navigate({ to: "/browse", search: { q } });
  };

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-background)] text-[var(--color-foreground)]">
      <header className="sticky top-0 z-20 border-b border-[var(--color-border)] bg-[var(--color-background)]/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-4 py-2">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <Bookmark className="h-5 w-5 text-[var(--color-primary)]" />
            <span>Reddit Saved</span>
          </Link>

          <nav className="ml-4 hidden gap-1 text-sm md:flex">
            <Link
              to="/"
              className={navClass(pathname === "/")}
              data-testid="nav-home"
            >
              Home
            </Link>
            <Link
              to="/browse"
              className={navClass(pathname.startsWith("/browse"))}
              data-testid="nav-browse"
            >
              Browse
            </Link>
          </nav>

          <div className="ml-auto flex flex-1 items-center justify-end gap-2">
            <div className="hidden flex-1 md:block">
              <SearchBar onSearch={onSearch} />
            </div>
            <DarkModeToggle />
            <Button asChild size="icon" variant="ghost" aria-label="Settings">
              <Link to="/settings" data-testid="nav-settings">
                <Settings className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
        <div className="mx-auto w-full max-w-7xl px-4 pb-2">
          <SyncStatus showControls={false} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <ErrorBoundary fallback={(err, reset) => <ErrorState error={err} onRetry={reset} />}>
          <Suspense fallback={<div className="p-6 text-sm">Loading...</div>}>
            {children}
          </Suspense>
        </ErrorBoundary>
      </main>

      <footer className="border-t border-[var(--color-border)] py-4 text-center text-xs text-[var(--color-muted-foreground)]">
        Reddit Saved · local archive
      </footer>
    </div>
  );
}

function navClass(active: boolean): string {
  return active
    ? "rounded px-2 py-1 font-medium text-[var(--color-foreground)]"
    : "rounded px-2 py-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]";
}
