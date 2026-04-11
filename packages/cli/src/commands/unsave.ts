import type { ListOptions } from "@reddit-saved/core";
import { flagBool, flagInt, flagStr } from "../args";
import { createContext } from "../context";
import {
  clearProgress,
  isHumanMode,
  printError,
  printInfo,
  printJson,
  printProgress,
  printTable,
  printWarning,
} from "../output";

export async function unsaveCmd(
  flags: Record<string, string | boolean>,
  positionals: string[],
): Promise<void> {
  const dryRun = flagBool(flags, "dry-run");
  const confirm = flagBool(flags, "confirm");

  if (!dryRun && !confirm) {
    printError(
      "Unsave is destructive and cannot be undone on Reddit. " +
        "Pass --confirm to proceed, or --dry-run to preview.",
    );
    process.exit(1);
  }

  // Collect IDs from --id flag or query filters
  const idFlag = flagStr(flags, "id");
  const ids: string[] = idFlag ? idFlag.split(",").map((s) => s.trim()) : [];

  const hasFilters =
    flagStr(flags, "subreddit") || flagStr(flags, "tag") || flagBool(flags, "orphaned");

  if (ids.length === 0 && !hasFilters) {
    printError("Specify items with --id or filter flags (--subreddit, --tag, --orphaned).");
    process.exit(1);
  }

  const needsApi = !dryRun;
  const ctx = await createContext({
    needsApi,
    needsAuth: needsApi,
    dbPath: flagStr(flags, "db"),
  });

  try {
    // Resolve IDs from filters
    if (ids.length === 0 && hasFilters) {
      const limit = flagInt(flags, "limit") ?? 1000;
      const opts: ListOptions = {
        subreddit: flagStr(flags, "subreddit"),
        tag: flagStr(flags, "tag"),
        orphaned: flagBool(flags, "orphaned") || undefined,
        limit,
      };
      const posts = ctx.storage.listPosts(opts);
      for (const p of posts) {
        ids.push(p.id);
      }
      if (posts.length >= limit) {
        printWarning(`Matched ${limit}+ items. Only the first ${limit} will be processed. Use --limit to adjust.`);
      }
    }

    if (ids.length === 0) {
      printInfo("No items match the given filters.");
      if (!isHumanMode()) printJson({ unsaved: 0 });
      return;
    }

    // Look up posts to get fullnames
    const items = ids.map((id) => ctx.storage.getPost(id)).filter((p) => p !== null);
    const foundIds = new Set(items.map((p) => p.id));
    const missingIds = ids.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
      printWarning(`Unknown IDs (not in database): ${missingIds.join(", ")}`);
    }

    if (items.length === 0) {
      printError("None of the specified IDs were found in the database.");
      process.exit(1);
    }

    // Dry run — just show what would be unsaved
    if (dryRun) {
      if (isHumanMode()) {
        console.log(`\nWould unsave ${items.length} item(s):\n`);
        printTable(
          items.map((p) => ({
            id: p.id,
            title: p.title || p.link_title || "(comment)",
            subreddit: p.subreddit,
          })),
          [
            { key: "id", header: "ID", width: 10 },
            { key: "title", header: "Title", width: 50 },
            { key: "subreddit", header: "Subreddit", width: 20 },
          ],
        );
      } else {
        printJson({ dryRun: true, count: items.length, ids: items.map((p) => p.id) });
      }
      return;
    }

    // Unsave on Reddit
    const fullnames = items.map((p) => p.name);
    printProgress(`Unsaving ${fullnames.length} items...`);

    const api = ctx.apiClient as NonNullable<typeof ctx.apiClient>;
    const result = await api.unsaveItems(fullnames);
    clearProgress();

    // Mark unsaved locally
    if (result.succeeded.length > 0) {
      const succeededIds: string[] = [];
      for (const name of result.succeeded) {
        const idx = name.indexOf("_");
        if (idx === -1) {
          printWarning(`Skipping unexpected fullname format: "${name}"`);
          continue;
        }
        succeededIds.push(name.slice(idx + 1));
      }
      if (succeededIds.length > 0) {
        ctx.storage.markUnsaved(succeededIds);
      }
    }

    if (isHumanMode()) {
      printInfo(
        `Unsaved ${result.succeeded.length} item(s).${result.failed.length > 0 ? ` ${result.failed.length} failed.` : ""}`,
      );
    } else {
      printJson({
        unsaved: result.succeeded.length,
        failed: result.failed.length,
        failedIds: result.failed.map((f) => f.id),
      });
    }
  } finally {
    ctx.close();
  }
}
