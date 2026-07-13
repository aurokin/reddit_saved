import { useToday } from "@/hooks/queries";
import type { ContentOrigin } from "@/types";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "../ui/button";

const ORIGIN_LABELS: Record<ContentOrigin, string> = {
  saved: "Saved",
  upvoted: "Upvoted",
  submitted: "Posted",
  commented: "Commented",
};

/** One-line "what's new" summary: per-origin new-to-archive counts plus new
 *  inbox items, with the full digest one clipboard tap away for agents. */
export function TodayStrip() {
  const today = useToday(24);
  const [copied, setCopied] = useState(false);

  const digest = today.data?.digest;
  if (!digest) return null;

  const copyMarkdown = async (): Promise<void> => {
    if (!today.data) return;
    await navigator.clipboard.writeText(today.data.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-sm"
      data-testid="today-strip"
    >
      <span className="font-medium">Last 24h</span>
      {digest.newByOrigin.map((o) => (
        <span key={o.origin} className="text-[var(--color-muted-foreground)]">
          {ORIGIN_LABELS[o.origin]}{" "}
          <span className={o.count > 0 ? "font-medium text-[var(--color-foreground)]" : undefined}>
            {o.count}
          </span>
        </span>
      ))}
      <span className="text-[var(--color-muted-foreground)]">
        Inbox{" "}
        <span
          className={
            digest.inbox.newCount > 0 ? "font-medium text-[var(--color-foreground)]" : undefined
          }
        >
          {digest.inbox.newCount}
        </span>
      </span>
      <Button
        size="sm"
        variant="ghost"
        className="ml-auto"
        onClick={() => void copyMarkdown()}
        data-testid="copy-today-markdown"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        <span className="ml-1">{copied ? "Copied" : "Copy as Markdown"}</span>
      </Button>
    </div>
  );
}
