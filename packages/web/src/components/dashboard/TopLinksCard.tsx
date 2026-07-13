import { useTopLinks } from "@/hooks/queries";
import { ExternalLink } from "lucide-react";
import { useMemo } from "react";

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

/** Most-referenced external links across the archive (last 30 days). */
export function TopLinksCard() {
  // Rounded to the hour so the query key stays stable across renders.
  const since = useMemo(() => {
    const nowSeconds = Math.floor(Date.now() / 3_600_000) * 3600;
    return nowSeconds - THIRTY_DAYS_SECONDS;
  }, []);
  const links = useTopLinks({ since, excludeReddit: true, limit: 5 });

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4"
      data-testid="top-links-card"
    >
      <h3 className="text-sm font-semibold">Top links (30d)</h3>
      {links.data && links.data.items.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {links.data.items.map((link) => (
            <li key={link.canonical_url} className="flex items-baseline gap-2 text-sm">
              <a
                href={link.sampleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate hover:underline"
                title={link.canonical_url}
              >
                {link.canonical_url}
                <ExternalLink className="ml-1 inline h-3 w-3 text-[var(--color-muted-foreground)]" />
              </a>
              <span className="shrink-0 text-xs text-[var(--color-muted-foreground)]">
                {link.postCount} post{link.postCount === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          No outbound links captured in the last 30 days.
        </p>
      )}
    </div>
  );
}
