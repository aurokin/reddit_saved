import { AlertTriangle } from "lucide-react";
import { Button } from "./ui/button";

export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-[var(--color-destructive)]/30 bg-[var(--color-destructive)]/5 p-6 text-center">
      <AlertTriangle className="h-6 w-6 text-[var(--color-destructive)]" />
      <p className="text-sm text-[var(--color-foreground)]">{message}</p>
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
