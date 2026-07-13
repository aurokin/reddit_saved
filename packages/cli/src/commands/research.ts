import { buildResearchBrief, renderResearchBrief } from "@reddit-cached/core";
import { flagBool, flagInt, flagStr, parseDateFlag } from "../args";
import { createContext } from "../context";
import { isHumanMode, printError, printInfo, printJson } from "../output";

/** `research <query>` — deterministic markdown brief assembled entirely from
 *  the local database (FTS seeds → stored threads → links). No AI, no network. */
export async function researchCmd(
  flags: Record<string, string | boolean>,
  positionals: string[],
): Promise<void> {
  const query = positionals.join(" ").trim();
  if (!query) {
    printError("Research query required. Usage: reddit-cached research <query>");
    process.exit(1);
  }

  const ctx = await createContext({ dbPath: flagStr(flags, "db") });
  try {
    const since = parseDateFlag(flagStr(flags, "since"), "since", "start");
    const until = parseDateFlag(flagStr(flags, "until"), "until", "end");
    if (since !== undefined && until !== undefined && since > until) {
      throw new Error("--since must be earlier than or equal to --until");
    }

    const brief = buildResearchBrief(ctx.storage, query, {
      limit: flagInt(flags, "limit") ?? 10,
      since,
      until,
    });

    if (flagBool(flags, "json")) {
      printJson(brief);
      return;
    }

    const markdown = renderResearchBrief(brief);
    const outPath = flagStr(flags, "out");
    if (outPath) {
      await Bun.write(outPath, markdown);
      if (isHumanMode()) {
        printInfo(`Wrote research brief to ${outPath}`);
      } else {
        printJson({ written: true, path: outPath, seeds: brief.seeds.length });
      }
    } else {
      process.stdout.write(markdown);
    }
  } finally {
    ctx.close();
  }
}
