# Reddit Cached

A local-first archive of your Reddit life. Reddit Cached pulls your saved,
upvoted, submitted, and commented content — plus your inbox — into a SQLite
database on your machine, then gives you a fast web dashboard and a JSON-first
CLI on top of it. Search a decade of saves in milliseconds, keep content Reddit
has deleted, escape the ~1000-item listing cap, and let your agents query the
same archive you browse.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/dashboard-dark.png">
  <img alt="Reddit Cached dashboard: per-origin sync health, today's activity, and inbox preview" src="docs/screenshots/dashboard-light.png">
</picture>

## Features

**Full-text search over everything you ever saved.** FTS5 across titles,
selftext, comment bodies, subreddits, authors, flair, and URLs — with filters
for subreddit, author, tag, score, date range, origin, and content type. Local
tags stay local.

![Browse page with full-text search results and the filter panel](docs/screenshots/search-light.png)

**An outbound link index.** Every URL mentioned in your archive, normalized and
deduplicated. Answer "what was that link someone posted about X?" without
remembering where you saw it.

![Links page listing outbound URLs with post and occurrence counts](docs/screenshots/links-light.png)

**Your inbox, cached and readable offline.** Comment replies, post replies,
mentions, and private messages sync into the archive; unread state mirrors
Reddit as of the last sync, and nothing is ever marked read on Reddit.

![Inbox page with comment replies, mentions, and messages](docs/screenshots/inbox-light.png)

**Sync provenance you can audit.** Every fetch records a sync run per origin;
the pipeline records job runs. The dashboard and settings page show exactly
what synced, when, and whether orphan detection saturated.

![Settings page with sync history and scheduled jobs tables](docs/screenshots/settings-light.png)

Plus: deterministic `research` briefs and `today` digests rendered entirely
from local data (no AI, no network), orphan detection for content removed from
Reddit, media previews, exports to JSON/CSV/Markdown, and selective bulk
unsave.

## Install & setup

The `reddit-cached` binary bundles the CLI and the web dashboard. Pick a
channel:

```bash
# One-liner (macOS/Linux, installs to ~/.local/bin)
curl -fsSL https://raw.githubusercontent.com/aurokin/reddit_cached/main/install.sh | bash

# Homebrew
brew install aurokin/tap/reddit-cached

# npm, if you have Bun (https://bun.sh) installed
bunx reddit-cached --help
```

Or download a platform tarball from the
[releases page](https://github.com/aurokin/reddit_cached/releases) and verify
it against `SHA256SUMS`. To run from a source checkout instead, see
[Development](#development).

Start the dashboard:

```bash
reddit-cached serve
```

Open `http://127.0.0.1:3001`, then connect your Reddit session:

1. Install the companion browser extension — download
   `reddit-cached-extension.zip` from the release page, unzip it, and "Load
   unpacked" in Chrome (or load `packages/extension` from a checkout — see
   [packages/extension/README.md](./packages/extension/README.md)). It
   forwards your reddit.com session cookies to the local app. This is the
   primary auth mode; OAuth (`reddit-cached auth login`) is a legacy fallback
   for users with a registered Reddit app.
2. Once the app shows you as connected, run a sync from the UI — or from the
   CLI. The extension session is enough for CLI fetches too:

```bash
reddit-cached fetch --all        # saved, upvoted, submitted, comments
reddit-cached fetch context      # capture thread context around saves
reddit-cached fetch inbox        # replies, mentions, messages
```

The database lives in the platform data directory — macOS:
`~/Library/Application Support/reddit-cached/reddit-cached.db`, Linux (XDG):
`~/.local/share/reddit-cached/reddit-cached.db`. The web app honors
`REDDIT_CACHED_DB=<path>`; the CLI takes `--db <path>`. By default the web UI
and CLI share the same database and auth files.

## Scheduled syncs

`reddit-cached jobs run` executes the full pipeline (fetch all origins →
capture context → sync inbox → backup). Install it on a timer with one command:

```bash
# macOS: launchd agent, hourly by default
reddit-cached jobs install-launchd --interval-seconds 3600

# Linux: systemd user units, hourly by default
reddit-cached jobs install-systemd --interval-seconds 3600
```

Check recent runs with `reddit-cached jobs status`, and remove the schedule
with `jobs uninstall-launchd` / `jobs uninstall-systemd`. Overlapping runs are
lock-protected and exit cleanly instead of racing.

## Import your Reddit GDPR export

Reddit's API only exposes the newest ~1000 items per listing. To backfill
beyond that, request your data export at
[reddit.com/settings/data-request](https://www.reddit.com/settings/data-request),
unzip it, and run:

```bash
reddit-cached import path/to/export --dry-run   # parse and count, no writes
reddit-cached import path/to/export
```

It reads the export CSVs (saved posts/comments, upvotes, your posts and
comments), skips items already archived, hydrates the rest from Reddit, and
stores content Reddit no longer serves as `[deleted]` stubs.

## Git backup

Back the archive up as deterministic JSONL in a git repository — byte-identical
output for the same database state, so an unchanged sync produces no commit:

```bash
reddit-cached backup init --repo ~/backups/reddit --push
reddit-cached backup sync --push
reddit-cached backup status
```

Once configured, the scheduled pipeline runs the backup step automatically.

## For agents

The CLI outputs JSON by default (pass `-H`/`--human` for tables), so every
command is directly pipeable:

```bash
reddit-cached search "cache invalidation" | jq -r '.[].title'
reddit-cached status | jq '.totalPosts, .lastSyncTime'
reddit-cached links top --window 90d --exclude-reddit | jq -r '.[].canonical_url'
reddit-cached research "rust async" --out brief.md   # deterministic markdown brief
reddit-cached today --window 7d                      # what's new digest
```

There is an agent skill at
[.agents/skills/reddit-cached/SKILL.md](./.agents/skills/reddit-cached/SKILL.md)
that teaches agents when to reach for `search` vs `research` vs `links` vs
`today`, and a drift guard test keeps it in sync with the real command surface.
The authoritative command reference is
[docs/interfaces/cli.md](./docs/interfaces/cli.md).

## Development

Requires [Bun](https://bun.sh). From a source checkout you can run the CLI
directly (`cd packages/cli && bun run src/index.ts`), serve the dashboard
(`cd packages/web && bun run build && bun run start`), or compile the
standalone binary:

```bash
git clone https://github.com/aurokin/reddit_cached && cd reddit_cached
bun install
bun run build:binary   # emits packages/cli/dist/reddit-cached (CLI + web dashboard)
```

Run the whole stack against deterministic fixture data — no Reddit account
needed:

```bash
bun install
bun run --filter @reddit-cached/web seed
cd packages/web
TEST_MODE=1 bun run dev
```

Open `http://localhost:3000`. `TEST_MODE=1` disables real Reddit sync and
writes. Verify the workspace (lint, typecheck, tests, web build, CLI smoke):

```bash
bun run verify
```

## Docs

- [docs/README.md](./docs/README.md) — docs hub and reader paths
- [docs/architecture.md](./docs/architecture.md) — packages, invariants, constraints
- [docs/interfaces/cli.md](./docs/interfaces/cli.md) — CLI reference
- [docs/interfaces/web-api.md](./docs/interfaces/web-api.md) — local web API
- [packages/web/README.md](./packages/web/README.md) — web app deep dive
- [packages/extension/README.md](./packages/extension/README.md) — companion extension
