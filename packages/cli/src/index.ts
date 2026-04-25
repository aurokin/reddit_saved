#!/usr/bin/env bun
/**
 * reddit-saved CLI entry point.
 *
 * Parses arguments, dispatches to the appropriate command handler,
 * and handles top-level errors and exit codes.
 */

import { VERSION } from "@reddit-saved/core";
import { flagBool, flagStr, parseArgs } from "./args";
import { printError, setOutputMode } from "./output";

// Auth commands
import { authLogin } from "./auth/login";
import { authLogout } from "./auth/logout";
import { authStatus } from "./auth/status";

import { exportCmd } from "./commands/export";
// Data commands
import { fetchCmd } from "./commands/fetch";
import { listCmd } from "./commands/list";
import { searchCmd } from "./commands/search";
import { statusCmd } from "./commands/status";
import { unsaveCmd } from "./commands/unsave";

// Tag commands
import {
  tagAdd,
  tagCreate,
  tagDelete,
  tagList,
  tagRemove,
  tagRename,
  tagShow,
} from "./commands/tag";

type CommandHandler = (
  flags: Record<string, string | boolean>,
  positionals: string[],
) => Promise<void>;

const COMMANDS: Record<string, CommandHandler> = {
  "auth login": authLogin,
  "auth status": authStatus,
  "auth logout": authLogout,
  fetch: fetchCmd,
  search: searchCmd,
  list: listCmd,
  status: statusCmd,
  export: exportCmd,
  unsave: unsaveCmd,
  "tag list": tagList,
  "tag create": tagCreate,
  "tag rename": tagRename,
  "tag delete": tagDelete,
  "tag add": tagAdd,
  "tag remove": tagRemove,
  "tag show": tagShow,
};

const USAGE = `reddit-saved v${VERSION} — Manage your Reddit saved posts locally

Usage: reddit-saved <command> [options]

Commands:
  auth login [--open-browser]  Authenticate with Reddit OAuth
  auth status             Show OAuth authentication status
  auth logout             Clear stored OAuth credentials

  fetch                   Fetch Reddit content into the local cache
  search <query>          Full-text search saved posts
  list                    Browse saved posts with filters
  status                  Show database statistics
  export                  Export posts to JSON/CSV/Markdown
  unsave                  Unsave posts on Reddit

  tag list                List all tags
  tag create <name>       Create a new tag
  tag rename <old> <new>  Rename a tag
  tag delete <name>       Delete a tag
  tag add <tag> --to <id> Tag a post
  tag remove <tag> --from <id>  Untag a post
  tag show <id>           Show tags for a post

Global options:
  --human, -H             Human-readable output (tables instead of JSON)
  --verbose, -v           Verbose output
  --quiet, -q             Suppress non-essential output
  --db <path>             Override database path
  --config <path>         Override config directory (auth.json, auth.lock)
  --help                  Show this help message
  --version               Show version

Auth login options:
  --open-browser          Open the Reddit authorization URL in your browser
  REDDIT_SAVED_OPEN_BROWSER=1 also enables automatic browser launch

Auth note:
  CLI auth commands manage legacy OAuth auth.json. Web extension session auth
  uses session.json and is managed from the local web app.
`;

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const { command, flags, positionals } = parsed;

  applyGlobalPathOverrides(flags);

  // Global mode flags
  setOutputMode(flagBool(flags, "human"), flagBool(flags, "verbose"), flagBool(flags, "quiet"));

  // --version
  if (flagBool(flags, "version")) {
    console.log(VERSION);
    return;
  }

  // --help or no command
  if (flagBool(flags, "help") || command.length === 0) {
    console.log(USAGE);
    return;
  }

  // Look up command handler
  const cmdKey = command.join(" ");
  const handler = COMMANDS[cmdKey];

  if (!handler) {
    printError(`Unknown command: ${cmdKey}. Run 'reddit-saved --help' for usage.`);
    process.exit(1);
  }

  // Pass --db through for context creation
  await handler(flags, positionals);
}

main().catch((err) => {
  printError(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

function applyGlobalPathOverrides(flags: Record<string, string | boolean>): void {
  const configPath = flagStr(flags, "config");
  if (configPath) {
    process.env.REDDIT_SAVED_CONFIG_DIR = configPath;
  }
}
