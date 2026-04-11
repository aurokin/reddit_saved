import {
  type ExportOptions,
  exportToCsv,
  exportToJson,
  exportToMarkdown,
} from "@reddit-saved/core";
import { flagBool, flagInt, flagStr, mapTypeFlag } from "../args";
import { createContext } from "../context";
import { isHumanMode, printError, printInfo, printJson } from "../output";

const VALID_FORMATS = new Set(["json", "csv", "markdown"]);

export async function exportCmd(
  flags: Record<string, string | boolean>,
  _positionals: string[],
): Promise<void> {
  const format = flagStr(flags, "format") ?? "json";
  if (!VALID_FORMATS.has(format)) {
    printError(`Invalid --format: "${format}". Must be one of: ${[...VALID_FORMATS].join(", ")}`);
    process.exit(1);
  }

  const outputPath = flagStr(flags, "output");

  const ctx = await createContext({ dbPath: flagStr(flags, "db") });

  try {
    const opts: ExportOptions = {
      subreddit: flagStr(flags, "subreddit"),
      tag: flagStr(flags, "tag"),
      orphaned: flagBool(flags, "orphaned") || undefined,
      kind: mapTypeFlag(flagStr(flags, "type")),
      limit: flagInt(flags, "limit"),
      includeRawJson: flagBool(flags, "include-raw"),
    };

    const exportFns = { json: exportToJson, csv: exportToCsv, markdown: exportToMarkdown } as const;
    const exportFn = exportFns[format as keyof typeof exportFns];
    const content = exportFn(ctx.storage, opts);

    if (outputPath) {
      await Bun.write(outputPath, content);
      if (isHumanMode()) {
        printInfo(`Exported to ${outputPath}`);
      } else {
        printJson({ exported: true, path: outputPath, format });
      }
    } else {
      // Write directly to stdout — don't wrap in JSON
      process.stdout.write(content);
    }
  } finally {
    ctx.close();
  }
}

