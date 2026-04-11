/**
 * Hand-rolled argument parser for the CLI.
 *
 * Supports:
 * - `--flag value` and `--flag=value`
 * - Boolean flags (no value following)
 * - Short aliases: -H → --human, -v → --verbose, -q → --quiet
 * - Command paths: first non-flag args form the command (e.g. ["tag", "create"])
 * - `--` stops flag parsing; remaining args become positionals
 */

export interface ParsedArgs {
  command: string[];
  flags: Record<string, string | boolean>;
  positionals: string[];
}

const SHORT_ALIASES: Record<string, string> = {
  H: "human",
  v: "verbose",
  q: "quiet",
};

/** Known commands and subcommands for disambiguating command vs. positional args */
const COMMAND_WORDS = new Set([
  "auth",
  "login",
  "status",
  "logout",
  "fetch",
  "search",
  "list",
  "export",
  "unsave",
  "tag",
  "create",
  "rename",
  "delete",
  "add",
  "remove",
  "show",
  "help",
]);

/** Second-level subcommands keyed by their parent command */
const SUBCOMMANDS: Record<string, Set<string>> = {
  auth: new Set(["login", "status", "logout"]),
  tag: new Set(["list", "create", "rename", "delete", "add", "remove", "show"]),
};

/** Flags that are always boolean — never consume the next argument as a value */
const BOOLEAN_FLAGS = new Set([
  "confirm",
  "full",
  "dry-run",
  "human",
  "verbose",
  "quiet",
  "help",
  "version",
  "orphaned",
  "include-raw",
]);

export function parseArgs(argv: string[]): ParsedArgs {
  const command: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  let i = 0;
  let commandDone = false;
  let flagsDone = false;

  while (i < argv.length) {
    const arg = argv[i];

    // -- stops flag parsing
    if (arg === "--") {
      flagsDone = true;
      i++;
      continue;
    }

    if (flagsDone) {
      positionals.push(arg);
      i++;
      continue;
    }

    // Long flag: --flag or --flag=value
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        const name = arg.slice(2, eqIdx);
        const val = arg.slice(eqIdx + 1);
        if (BOOLEAN_FLAGS.has(name)) {
          flags[name] = val !== "false" && val !== "0" && val !== "";
        } else {
          flags[name] = val;
        }
      } else {
        const name = arg.slice(2);
        if (BOOLEAN_FLAGS.has(name)) {
          flags[name] = true;
        } else {
          const next = argv[i + 1];
          if (next !== undefined && (!next.startsWith("-") || /^-\d/.test(next))) {
            flags[name] = next;
            i++;
          } else {
            flags[name] = true;
          }
        }
      }
      i++;
      continue;
    }

    // Short flag: -H, -v, -q
    if (arg.startsWith("-") && arg.length === 2) {
      const alias = SHORT_ALIASES[arg[1]];
      if (alias) {
        flags[alias] = true;
      } else {
        flags[arg[1]] = true;
      }
      i++;
      continue;
    }

    // Command word or positional
    if (!commandDone) {
      if (command.length === 0 && COMMAND_WORDS.has(arg)) {
        command.push(arg);
        i++;
        continue;
      }
      if (command.length === 1 && SUBCOMMANDS[command[0]]?.has(arg)) {
        command.push(arg);
        i++;
        continue;
      }
      // Not a recognized subcommand — we're done parsing command path
      commandDone = true;
    }

    positionals.push(arg);
    i++;
  }

  return { command, flags, positionals };
}

/** Get a flag value as string, or undefined if not present/boolean */
export function flagStr(flags: Record<string, string | boolean>, name: string): string | undefined {
  const val = flags[name];
  if (typeof val !== "string") return undefined;
  return val;
}

/** Get a flag value as integer, or undefined if not present */
export function flagInt(flags: Record<string, string | boolean>, name: string): number | undefined {
  const val = flagStr(flags, name);
  if (val === undefined) return undefined;
  const n = Number.parseInt(val, 10);
  if (Number.isNaN(n)) throw new Error(`--${name} must be an integer, got "${val}"`);
  return n;
}

/** Check if a boolean flag is set */
export function flagBool(flags: Record<string, string | boolean>, name: string): boolean {
  return flags[name] === true;
}

/** Parse a date flag into a Unix timestamp in seconds. */
export function parseDateFlag(
  value: string | undefined,
  name: string,
  boundary: "start" | "end",
): number | undefined {
  if (value === undefined) return undefined;

  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  let millis: number;

  if (dateOnlyMatch) {
    const [, yearStr, monthStr, dayStr] = dateOnlyMatch;
    const year = Number.parseInt(yearStr, 10);
    const month = Number.parseInt(monthStr, 10);
    const day = Number.parseInt(dayStr, 10);
    const base = Date.UTC(year, month - 1, day);
    millis = boundary === "start" ? base : base + 86_400_000 - 1;
  } else {
    millis = Date.parse(value);
  }

  if (Number.isNaN(millis)) {
    throw new Error(`Invalid --${name}: "${value}". Use YYYY-MM-DD or an ISO-8601 date/time.`);
  }

  return Math.floor(millis / 1000);
}

/** Map --type post/comment flag to Reddit kind prefix. Throws on unrecognized values. */
export function mapTypeFlag(type: string | undefined): "t1" | "t3" | undefined {
  if (type === undefined) return undefined;
  if (type === "post") return "t3";
  if (type === "comment") return "t1";
  throw new Error(`Invalid --type: "${type}". Must be one of: post, comment`);
}
