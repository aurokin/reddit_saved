import type { SearchOptions } from "@reddit-saved/core";
import { flagBool, flagInt, flagStr, mapTypeFlag, parseDateFlag } from "../args";
import { createContext } from "../context";
import {
  POST_COLUMNS_WITH_SNIPPET,
  formatPostForOutput,
  isHumanMode,
  printError,
  printJson,
  printTable,
} from "../output";

export async function searchCmd(
  flags: Record<string, string | boolean>,
  positionals: string[],
): Promise<void> {
  const query = positionals[0];
  if (!query) {
    printError("Search query required. Usage: reddit-saved search <query>");
    process.exit(1);
  }

  const ctx = await createContext({ dbPath: flagStr(flags, "db") });

  try {
    const createdAfter = parseDateFlag(flagStr(flags, "after"), "after", "start");
    const createdBefore = parseDateFlag(flagStr(flags, "before"), "before", "end");
    if (createdAfter !== undefined && createdBefore !== undefined && createdAfter > createdBefore) {
      throw new Error("--after must be earlier than or equal to --before");
    }

    const opts: SearchOptions = {
      subreddit: flagStr(flags, "subreddit"),
      author: flagStr(flags, "author"),
      minScore: flagInt(flags, "min-score"),
      tag: flagStr(flags, "tag"),
      orphaned: flagBool(flags, "orphaned") || undefined,
      kind: mapTypeFlag(flagStr(flags, "type")),
      createdAfter,
      createdBefore,
      limit: flagInt(flags, "limit") ?? 25,
      offset: flagInt(flags, "offset"),
    };

    const results = ctx.storage.searchPosts(query, opts);
    const formatted = results.map((r) => formatPostForOutput(r));

    if (isHumanMode()) {
      console.log(`\n${results.length} result(s) for "${query}"\n`);
      printTable(formatted, POST_COLUMNS_WITH_SNIPPET);
    } else {
      printJson(formatted);
    }
  } finally {
    ctx.close();
  }
}
