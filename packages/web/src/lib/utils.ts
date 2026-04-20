import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

/** Format a unix-seconds timestamp as a short relative string (e.g. "3 days ago"). */
export function formatRelative(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return "";
  const diff = unixSeconds - Date.now() / 1000;
  const absDiff = Math.abs(diff);
  for (const [unit, seconds] of UNITS) {
    if (absDiff >= seconds || unit === "second") {
      return rtf.format(Math.round(diff / seconds), unit);
    }
  }
  return "";
}

export function formatNumber(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function parseTags(tags?: string | null): string[] {
  if (!tags) return [];
  return tags
    .split("||")
    .map((t) => t.trim())
    .filter(Boolean);
}
