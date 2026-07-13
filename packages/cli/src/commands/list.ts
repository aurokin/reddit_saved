import type { ListOptions } from "@reddit-saved/core";
import { flagBool, flagInt, flagStr, mapTypeFlag, parseDateFlag } from "../args";
import { createContext } from "../context";
import {
  POST_COLUMNS,
  formatPostForOutput,
  isHumanMode,
  printError,
  printJson,
  printTable,
} from "../output";

const VALID_ORIGINS = new Set(["saved", "upvoted", "submitted", "commented", "context"]);

export async function listCmd(
  flags: Record<string, string | boolean>,
  _positionals: string[],
): Promise<void> {
  const originStr = flagStr(flags, "origin");
  if (originStr && !VALID_ORIGINS.has(originStr)) {
    printError(
      `Invalid --origin: "${originStr}". Must be one of: ${[...VALID_ORIGINS].join(", ")}`,
    );
    process.exit(1);
  }

  const sortVal = flagStr(flags, "sort") ?? "created";
  if (sortVal !== "created" && sortVal !== "score") {
    printError(`Invalid --sort: "${sortVal}". Must be one of: created, score`);
    process.exit(1);
  }

  const sortDirVal = flagStr(flags, "sort-direction") ?? "desc";
  if (sortDirVal !== "asc" && sortDirVal !== "desc") {
    printError(`Invalid --sort-direction: "${sortDirVal}". Must be one of: asc, desc`);
    process.exit(1);
  }

  const ctx = await createContext({ dbPath: flagStr(flags, "db") });

  try {
    const createdAfter = parseDateFlag(flagStr(flags, "after"), "after", "start");
    const createdBefore = parseDateFlag(flagStr(flags, "before"), "before", "end");
    if (createdAfter !== undefined && createdBefore !== undefined && createdAfter > createdBefore) {
      throw new Error("--after must be earlier than or equal to --before");
    }

    const opts: ListOptions = {
      subreddit: flagStr(flags, "subreddit"),
      author: flagStr(flags, "author"),
      minScore: flagInt(flags, "min-score"),
      tag: flagStr(flags, "tag"),
      orphaned: flagBool(flags, "orphaned") || undefined,
      kind: mapTypeFlag(flagStr(flags, "type")),
      hideLowQuality: flagBool(flags, "hide-low-quality") || undefined,
      includeContext: flagBool(flags, "include-context") || undefined,
      createdAfter,
      createdBefore,
      contentOrigin: originStr as ListOptions["contentOrigin"],
      sort: sortVal as "created" | "score",
      sortDirection: sortDirVal as "asc" | "desc",
      limit: flagInt(flags, "limit") ?? 25,
      offset: flagInt(flags, "offset"),
    };

    const results = ctx.storage.listPosts(opts);
    const formatted = results.map((r) => formatPostForOutput(r));

    if (isHumanMode()) {
      console.log(`\n${results.length} item(s)\n`);
      printTable(formatted, POST_COLUMNS);
    } else {
      printJson(formatted);
    }
  } finally {
    ctx.close();
  }
}
