import { flagBool, flagInt, flagStr } from "../args";
import { createContext } from "../context";
import { isHumanMode, printError, printInfo, printJson, printTable } from "../output";

/** Parse a window like "90d", "12w", "6m", "1y" into a created_utc cutoff
 *  (epoch seconds). Returns undefined when no window was given. */
export function parseWindowToSince(
  window: string | undefined,
  now = Date.now(),
): number | undefined {
  if (!window) return undefined;
  const match = window.match(/^(\d+)([dwmy])$/i);
  if (!match) {
    throw new Error(`Invalid --window: "${window}". Use forms like 90d, 12w, 6m, 1y.`);
  }
  const value = Number.parseInt(match[1], 10);
  const daysPerUnit = { d: 1, w: 7, m: 30, y: 365 }[
    match[2].toLowerCase() as "d" | "w" | "m" | "y"
  ];
  return Math.floor(now / 1000) - value * daysPerUnit * 24 * 60 * 60;
}

export async function linksTopCmd(
  flags: Record<string, string | boolean>,
  _positionals: string[],
): Promise<void> {
  let since: number | undefined;
  try {
    since = parseWindowToSince(flagStr(flags, "window"));
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const ctx = await createContext({ dbPath: flagStr(flags, "db") });
  try {
    const rows = ctx.storage.topLinks({
      since,
      excludeReddit: flagBool(flags, "exclude-reddit"),
      limit: flagInt(flags, "limit") ?? 25,
    });

    if (isHumanMode()) {
      console.log(`\n${rows.length} link(s)\n`);
      printTable(
        rows.map((r) => ({
          link: r.canonical_url,
          host: r.host,
          posts: r.postCount,
          lastSeen: new Date(r.lastSeen * 1000).toISOString().slice(0, 10),
        })),
        [
          { key: "link", header: "Link" },
          { key: "host", header: "Host" },
          { key: "posts", header: "Posts" },
          { key: "lastSeen", header: "Last seen" },
        ],
      );
    } else {
      printJson(rows);
    }
  } finally {
    ctx.close();
  }
}

export async function linksSearchCmd(
  flags: Record<string, string | boolean>,
  positionals: string[],
): Promise<void> {
  const pattern = positionals.join(" ").trim();
  if (!pattern) {
    printError("Search pattern required. Usage: reddit-cached links search <pattern>");
    process.exit(1);
  }

  const ctx = await createContext({ dbPath: flagStr(flags, "db") });
  try {
    const rows = ctx.storage.searchLinks(pattern, { limit: flagInt(flags, "limit") ?? 25 });

    if (isHumanMode()) {
      console.log(`\n${rows.length} occurrence(s) for "${pattern}"\n`);
      printTable(
        rows.map((r) => ({
          url: r.url,
          subreddit: r.subreddit,
          title: r.title ?? "",
          post: r.post_id,
        })),
        [
          { key: "url", header: "URL" },
          { key: "subreddit", header: "Subreddit" },
          { key: "title", header: "Title" },
          { key: "post", header: "Post" },
        ],
      );
    } else {
      printJson(rows);
    }
  } finally {
    ctx.close();
  }
}

export async function linksRebuildCmd(
  flags: Record<string, string | boolean>,
  _positionals: string[],
): Promise<void> {
  const ctx = await createContext({ dbPath: flagStr(flags, "db") });
  try {
    const occurrences = ctx.storage.rebuildLinkIndex();
    if (isHumanMode()) {
      printInfo(`Rebuilt link index: ${occurrences} occurrence(s).`);
    } else {
      printJson({ rebuilt: true, occurrences });
    }
  } finally {
    ctx.close();
  }
}
