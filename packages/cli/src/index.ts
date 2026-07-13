#!/usr/bin/env bun
/**
 * reddit-cached CLI entry point.
 *
 * Parses arguments, dispatches to the appropriate command handler,
 * and handles top-level errors and exit codes.
 */

import { VERSION } from "@reddit-cached/core";
import { flagBool, flagStr, parseArgs } from "./args";
import { COMMANDS } from "./commands/registry";
import { printError, setOutputMode } from "./output";

const USAGE = `reddit-cached v${VERSION} — Manage your Reddit saved posts locally

Usage: reddit-cached <command> [options]

Commands:
  auth login [--open-browser]  Authenticate with Reddit OAuth
  auth status             Show OAuth authentication status
  auth logout             Clear stored OAuth credentials

  fetch                   Fetch Reddit content into the local cache
                          --type saved|upvoted|submitted|comments (default saved)
                          --all fetches every type; --full resyncs from scratch
  fetch context           Capture thread context around saved items
                          --limit N (default 50), --top-comments N (default 20),
                          --refresh <days> re-captures stale context
  fetch inbox             Sync comment replies, mentions, and messages
                          --limit N (default 200)
  inbox                   Read synced inbox items (local, unread first)
                          --type comment_reply|post_reply|mention|message,
                          --unread, --limit N (default 25)
  search <query>          Full-text search saved posts
  list                    Browse saved posts with filters
  research <query>        Deterministic markdown brief from local data
                          --limit N, --since/--until, --out <file>, --json
  today                   What's new: activity, inbox, links, sync health
                          --window 24h|7d|since-last-job, --out, --json
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

  links top               Most-referenced links across your saved content
                          --window 90d|6m|1y, --exclude-reddit, --limit N
  links search <pattern>  Find posts referencing a URL substring
  links rebuild           Rebuild the derived link index from posts

  backup init             Configure a git-backed JSONL backup repository
                          --repo <path> [--remote <name>] [--push]
  backup sync             Write the backup and commit (deterministic JSONL)
                          [--push] [--no-git]
  backup status           Compare the database against the last backup

  jobs run                Run the sync pipeline: fetch, context, inbox, backup
                          --steps <comma list> to run a subset, --limit N
  jobs status             Recent pipeline runs and whether one is running now
  jobs install-launchd    Schedule the pipeline via launchd (macOS)
                          --interval-seconds N (default 3600), --steps,
                          --label <name>, --no-load
  jobs uninstall-launchd  Unload and remove the launchd agent

List/search/export options:
  --hide-low-quality      Exclude deleted/removed content, bot posts, and
                          low-score short comments
  --include-context       Include thread-context rows captured by
                          'fetch context' (excluded by default)

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
  Fetch commands prefer the browser-extension session (session.json) and fall
  back to OAuth (auth.json). CLI auth commands manage only the OAuth file;
  the extension session is managed from the local web app.
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
    printError(`Unknown command: ${cmdKey}. Run 'reddit-cached --help' for usage.`);
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
