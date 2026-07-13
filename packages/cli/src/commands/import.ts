import { statSync } from "node:fs";
import { CONTENT_ORIGINS, type ContentOrigin, importGdprExport } from "@reddit-cached/core";
import { flagBool, flagInt, flagStr } from "../args";
import { createContext } from "../context";
import { clearProgress, isHumanMode, printError, printJson, printProgress } from "../output";

/** `import <dir>` — backfill the archive from an unzipped Reddit GDPR data
 *  export (reddit.com/settings/data-request), reaching past Reddit's
 *  ~1000-item listing cap. Items are hydrated via /api/info; content Reddit
 *  no longer serves is stored as an orphaned stub. */
export async function importCmd(
  flags: Record<string, string | boolean>,
  positionals: string[],
): Promise<void> {
  const dir = positionals[0];
  if (!dir) {
    printError("Usage: reddit-cached import <dir> [--types a,b] [--limit N] [--dry-run]");
    process.exit(1);
  }

  let isDirectory: boolean;
  try {
    isDirectory = statSync(dir).isDirectory();
  } catch {
    printError(`No such file or directory: ${dir}`);
    process.exit(1);
  }
  if (!isDirectory) {
    if (dir.endsWith(".zip")) {
      printError(
        `${dir} is a ZIP file. Unzip it first (e.g. 'unzip ${dir} -d export/') and pass the extracted directory.`,
      );
    } else {
      printError(`Not a directory: ${dir}`);
    }
    process.exit(1);
  }

  let types: ContentOrigin[] | undefined;
  const typesFlag = flagStr(flags, "types");
  if (typesFlag !== undefined) {
    const parsed = typesFlag
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    for (const t of parsed) {
      if (!CONTENT_ORIGINS.includes(t as ContentOrigin)) {
        printError(`Invalid --types value: "${t}". Must be one of: ${CONTENT_ORIGINS.join(", ")}`);
        process.exit(1);
      }
    }
    types = parsed as ContentOrigin[];
  }

  const dryRun = flagBool(flags, "dry-run");
  const ctx = await createContext({ needsApi: !dryRun, dbPath: flagStr(flags, "db") });

  try {
    const result = await importGdprExport(ctx.storage, ctx.apiClient ?? null, {
      dir,
      types,
      limit: flagInt(flags, "limit"),
      dryRun,
      onProgress: (origin, processed, total) => {
        printProgress(`Importing ${origin}: ${processed}/${total} items...`);
      },
    });

    clearProgress();

    if (isHumanMode()) {
      if (result.perOrigin.length === 0) {
        console.log("No known export CSVs found in that directory.");
      }
      for (const o of result.perOrigin) {
        console.log(
          `${o.origin.padEnd(9)}  found ${o.found}, already present ${o.alreadyPresent}, ` +
            `hydrated ${o.hydrated}, deleted stubs ${o.deletedStubs}`,
        );
      }
      if (result.wasCancelled) console.log("(cancelled before finishing)");
    } else {
      printJson(result);
    }
  } finally {
    ctx.close();
  }
}
