# CLI Reference

## Entry Point

```text
reddit-cached
```

## Commands

```text
reddit-cached auth login [--open-browser]
reddit-cached auth status|logout
reddit-cached fetch [--full] [--type saved|upvoted|submitted|comments | --all] [--limit N]
reddit-cached fetch context [--limit N] [--top-comments N] [--refresh <days>]
reddit-cached fetch inbox [--limit N]
reddit-cached inbox [--type comment_reply|post_reply|mention|message] [--unread] [--limit N]
reddit-cached search <query> [filter flags] [--limit N] [--offset N]
reddit-cached list [filter flags] [--origin <o>] [--sort created|score] [--sort-direction asc|desc] [--limit N] [--offset N]
reddit-cached research <query> [--limit N] [--since d] [--until d] [--out f.md] [--json]
reddit-cached today [--window 24h|7d|since-last-job] [--out f.md] [--json]
reddit-cached export [--format json|csv|markdown] [--output <file>] [--include-raw] [filter flags] [--limit N]
reddit-cached import <dir> [--types saved,upvoted,submitted,commented] [--limit N] [--dry-run]
reddit-cached status
reddit-cached serve [--port N]
reddit-cached unsave [--id <id,...>] [--subreddit <r>] [--tag <t>] [--orphaned] [--limit N] [--dry-run] --confirm
reddit-cached tag list|create|rename|delete|add|remove|show
reddit-cached links top [--window 90d] [--exclude-reddit] [--limit N]
reddit-cached links search <pattern> [--limit N]
reddit-cached links rebuild
reddit-cached backup init --repo <path> [--remote <name>] [--push]
reddit-cached backup sync [--push] [--no-git]
reddit-cached backup status
reddit-cached jobs run [--steps fetch,context,inbox,backup] [--limit N] [--trigger <name>]
reddit-cached jobs status [--limit N]
reddit-cached jobs install-launchd [--interval-seconds N] [--steps <list>] [--label <name>] [--no-load]
reddit-cached jobs uninstall-launchd [--label <name>]
reddit-cached jobs install-systemd [--interval-seconds N] [--steps <list>] [--unit-name <name>] [--no-enable]
reddit-cached jobs uninstall-systemd [--unit-name <name>]
```

## Notes

- The CLI is the operator and automation surface over the shared local SQLite
  database.
- Every command resolves the database the same way: `--db <path>` >
  `REDDIT_CACHED_DB` env var > platform default — the same precedence the web
  app uses.
- JSON-oriented output is the default shape for composable usage.
- Filter flags, shared by `search`, `list`, and `export`: `--subreddit <r>`,
  `--tag <t>`, `--orphaned`, `--type post|comment`, `--hide-low-quality`,
  `--include-context`; `search` and `list` additionally accept
  `--author <name>`, `--min-score N`, and `--after`/`--before <date>`. All
  three take `--limit N` (default 25 for `search`/`list`; `export` is
  unlimited by default).
- `unsave` selects items with either `--id` (comma-separated, and additional
  ids may follow as positionals) or the filter selectors `--subreddit`,
  `--tag`, `--orphaned` (capped at `--limit`, default 1000) — never both, and
  bare positionals without `--id` are an error.
- CLI auth commands manage the legacy OAuth file, `auth.json`. The web app's
  companion-extension session files, `session.json` and `session.blocked.json`,
  are managed from the local web app.
- Fetch commands use whichever auth is available, preferring the extension
  session over OAuth (same priority as the web app) — connecting the browser
  extension is enough to use `fetch` and `fetch context` from the CLI.
- `auth login` prints the Reddit authorization URL by default. Pass
  `--open-browser` or set `REDDIT_CACHED_OPEN_BROWSER=1` to launch it
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
- `import` backfills the archive from an unzipped Reddit GDPR data export
  (request one at reddit.com/settings/data-request) — the way to reach past
  Reddit's ~1000-item listing cap. It reads `saved_posts.csv`,
  `saved_comments.csv`, `post_votes.csv` (upvotes only), `posts.csv`, and
  `comments.csv`, skips items already in the archive, hydrates the rest via
  `/api/info`, and stores content Reddit no longer serves as orphaned
  `[deleted]` stubs. `--dry-run` parses and counts without network calls or
  writes. Imports are not syncs: no `sync_runs` rows are written, and imported
  items show as new-to-archive in `today`.
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
- `today` renders a deterministic "what's new" digest from local data only:
  items new to the archive per origin (windowed on `fetched_at`), inbox
  activity, top new links, sync health per origin, context-capture progress,
  and the last pipeline run. `--window since-last-job` measures from the
  start of the last complete `jobs run`.
- `backup` writes deterministic JSONL (posts sharded by UTC year, plus tags,
  post_tags, sync_state, and inbox_items; derived tables excluded) into a git
  repository
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
  `~/Library/LaunchAgents/com.reddit-cached.jobs.plist` running `jobs run
  --trigger launchd` every `--interval-seconds` (default hourly, plus once at
  load) and loads it via `launchctl load -w`. Logs land in the data
  directory's `logs/` folder. Re-running the command re-installs with the new
  settings; `jobs uninstall-launchd` unloads and deletes the plist.
- `jobs install-systemd` (Linux only) is the systemd sibling of
  `install-launchd`: it writes `~/.config/systemd/user/reddit-cached-jobs.service`
  and `.timer` units running `jobs run --trigger systemd` every
  `--interval-seconds` (default hourly, plus two minutes after boot), then
  enables the timer via `systemctl --user enable --now` unless `--no-enable`
  (enable failures are tolerated with a warning — the units are still on
  disk). Output goes to the user journal (`journalctl --user -u
  reddit-cached-jobs.service`), not log files. `jobs uninstall-systemd`
  disables the timer and removes both units.
- Each fetch writes a per-origin resume checkpoint
  (`.reddit-import-checkpoint.<origin>.json` next to the database) and records
  provenance in the `sync_runs` table; `status` reports the latest run per
  origin, including saturation (Reddit exposes only the newest ~1000 items per
  listing).
- `status` also derives a `warnings` array (last pipeline run errored with its
  failed step names; not authenticated / session disconnected) from existing
  state — shown prominently at the top in `--human` mode.
- `serve` starts the web dashboard (API + SPA) on `--port` (default 3001,
  bound to 127.0.0.1) and prints the URL to stderr. Compiled binaries built
  with `bun run build:binary` embed the SPA assets, so one downloaded file is
  both the CLI and the dashboard; from a source checkout it serves
  `packages/web/dist` (run the web build first). `--db` maps onto
  `REDDIT_CACHED_DB`, the same variable the standalone web server uses.
