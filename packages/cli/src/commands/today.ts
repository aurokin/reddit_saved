import { buildTodayDigest, renderTodayDigest } from "@reddit-cached/core";
import { flagBool, flagStr } from "../args";
import { createContext } from "../context";
import { isHumanMode, printError, printInfo, printJson, printWarning } from "../output";

/** Parse --window into ms: "24h", "36h", "7d", or "since-last-job".
 *  Returns undefined for since-last-job so the caller resolves it. */
export function parseWindowMs(window: string | undefined): number | "since-last-job" {
  if (!window) return 24 * 60 * 60 * 1000;
  if (window === "since-last-job") return "since-last-job";
  const match = window.match(/^(\d+)([hd])$/i);
  if (!match) {
    throw new Error(`Invalid --window: "${window}". Use forms like 24h, 36h, 7d, since-last-job.`);
  }
  const value = Number.parseInt(match[1], 10);
  const msPerUnit = match[2].toLowerCase() === "h" ? 3_600_000 : 86_400_000;
  return value * msPerUnit;
}

/** `today` — deterministic "what's new" digest from local data only:
 *  new items per origin, inbox activity, links, sync health. No AI, no network. */
export async function todayCmd(
  flags: Record<string, string | boolean>,
  _positionals: string[],
): Promise<void> {
  const parsed = parseWindowMs(flagStr(flags, "window"));

  const ctx = await createContext({ dbPath: flagStr(flags, "db") });
  try {
    let windowMs: number;
    if (parsed === "since-last-job") {
      const lastJob = ctx.storage.getLastCompleteJobRun();
      if (lastJob) {
        windowMs = Math.max(60_000, Date.now() - lastJob.startedAt);
      } else {
        printWarning("No complete pipeline run recorded yet — falling back to a 24h window.");
        windowMs = 24 * 60 * 60 * 1000;
      }
    } else {
      windowMs = parsed;
    }

    const digest = buildTodayDigest(ctx.storage, { windowMs });

    if (flagBool(flags, "json")) {
      printJson(digest);
      return;
    }

    const markdown = renderTodayDigest(digest);
    const outPath = flagStr(flags, "out");
    if (outPath) {
      await Bun.write(outPath, markdown);
      if (isHumanMode()) {
        printInfo(`Wrote digest to ${outPath}`);
      } else {
        printJson({ written: true, path: outPath });
      }
    } else {
      process.stdout.write(markdown);
    }
  } finally {
    ctx.close();
  }
}
