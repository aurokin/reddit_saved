# CLI Reference

## Entry Point

```text
reddit-saved
```

## Commands

```text
reddit-saved auth login [--open-browser]
reddit-saved auth status|logout
reddit-saved fetch [--full] [--type saved|upvoted|submitted|comments | --all] [--limit N]
reddit-saved fetch context [--limit N] [--top-comments N] [--refresh <days>]
reddit-saved fetch inbox [--limit N]
reddit-saved inbox [--type comment_reply|post_reply|mention|message] [--unread] [--limit N]
reddit-saved search <query> [filters...]
reddit-saved list [filters...]
reddit-saved research <query> [--limit N] [--since d] [--until d] [--out f.md] [--json]
reddit-saved export [--format json|csv|markdown] [filters...]
reddit-saved status
reddit-saved unsave [selectors...] [--dry-run] --confirm
reddit-saved tag list|create|rename|delete|add|remove|show
reddit-saved links top [--window 90d] [--exclude-reddit] [--limit N]
reddit-saved links search <pattern> [--limit N]
reddit-saved links rebuild
reddit-saved backup init --repo <path> [--remote <name>] [--push]
reddit-saved backup sync [--push] [--no-git]
reddit-saved backup status
reddit-saved jobs run [--steps fetch,context,inbox,backup] [--limit N] [--trigger <name>]
reddit-saved jobs status [--limit N]
reddit-saved jobs install-launchd [--interval-seconds N] [--steps <list>] [--label <name>] [--no-load]
reddit-saved jobs uninstall-launchd [--label <name>]
```

## Notes

- The CLI is the operator and automation surface over the shared local SQLite
  database.
- JSON-oriented output is the default shape for composable usage.
- CLI auth commands manage the legacy OAuth file, `auth.json`. The web app's
  companion-extension session files, `session.json` and `session.blocked.json`,
  are managed from the local web app.
- Fetch commands use whichever auth is available, preferring the extension
  session over OAuth (same priority as the web app) — connecting the browser
  extension is enough to use `fetch` and `fetch context` from the CLI.
- `auth login` prints the Reddit authorization URL by default. Pass
  `--open-browser` or set `REDDIT_SAVED_OPEN_BROWSER=1` to launch it
  automatically.
- `auth logout` clears OAuth credentials only; it does not disconnect the web
  companion-extension session.
- `fetch --all` runs every content type sequentially; a failing type does not
  abort the rest, and the exit code is 1 if any type errored.
- `fetch context` captures thread context around saved items (ancestors for
  saved comments, top comments for saved posts) as `content_origin = 'context'`
  rows. Context rows are excluded from `list`/`search`/`export` unless
  `--include-context` (or `--origin context`) is passed, and they never
  participate in orphan detection. Progress is per-item via
  `context_fetched_at`; rerun the command to work through the backlog.
- `fetch inbox` syncs the Reddit inbox (comment replies, post replies,
  username mentions, private messages) into the `inbox_items` table and stops
  early once a page contains nothing new or changed. Replies and mentions are
  also mirrored into `posts` as context rows. `inbox` reads the table offline,
  unread first; `is_new` mirrors Reddit's unread flag as of the last sync and
  nothing is ever marked read on Reddit.
- `links` queries a derived `link_occurrences` index of every outbound URL in
  stored content (normalized: lowercased host, no www./fragment/tracking
  params). It is maintained automatically during fetches; `links rebuild`
  regenerates it from the posts table. `--window` accepts `90d`, `12w`, `6m`,
  `1y`.
- `research` renders a deterministic markdown brief entirely from local data:
  FTS seed matches (low-quality rows excluded), the stored thread around each
  seed (including captured context), outbound links, and subreddit counts.
  No AI, no network, no timestamps — identical database state renders an
  identical brief. Run `fetch context` first for richer threads.
- `backup` writes deterministic JSONL (posts sharded by UTC year, plus tags,
  post_tags, and sync_state; derived tables excluded) into a git repository
  configured in `<configDir>/config.json`. Output is byte-identical for the
  same database state, so an unchanged sync produces no commit. Commits are
  made with GPG signing disabled; `--push` (or `push: true` in config) pushes
  to the configured remote.
- `jobs run` executes the full sync pipeline sequentially (fetch all origins →
  capture context → sync inbox → backup); a failing step is recorded in the
  `job_runs` table but does not abort later steps, and the exit code is 1 if
  any step failed. The backup step is skipped (still ok) when no backup repo
  is configured. A `.reddit-jobs.lock` file next to the database makes an
  overlapping run exit 0 with `{"skipped":true}` instead of racing; locks
  older than two hours are reclaimed as stale.
- `jobs install-launchd` (macOS only) writes
  `~/Library/LaunchAgents/com.reddit-saved.jobs.plist` running `jobs run
  --trigger launchd` every `--interval-seconds` (default hourly, plus once at
  load) and loads it via `launchctl load -w`. Logs land in the data
  directory's `logs/` folder. Re-running the command re-installs with the new
  settings; `jobs uninstall-launchd` unloads and deletes the plist.
- Each fetch writes a per-origin resume checkpoint
  (`.reddit-import-checkpoint.<origin>.json` next to the database) and records
  provenance in the `sync_runs` table; `status` reports the latest run per
  origin, including saturation (Reddit exposes only the newest ~1000 items per
  listing).
