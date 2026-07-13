---
name: reddit-saved
description: "Search and analyze the user's Reddit saved/upvoted/submitted/commented archive: full-text search, research briefs with thread context, shared-link lookups, quality filters, and JSONL backups. Use whenever the user asks about their Reddit saves or Reddit history; prefer the local archive over live Reddit."
---

# reddit-saved

Use this for questions about the user's Reddit content before any live Reddit
lookup. The archive is a local SQLite cache; every command below is offline
except `fetch`.

## Data

Prefer:

1. The CLI from the repo: `cd packages/cli && bun run src/index.ts <command>`
2. An installed `reddit-saved` binary
3. Direct SQLite as a last resort: `~/Library/Application Support/reddit-saved/reddit-saved.db`
   (Linux: `~/.local/share/reddit-saved/reddit-saved.db`; override with `REDDIT_SAVED_DB`)

Check health and freshness before analysis:

```bash
reddit-saved status
```

The JSON includes totals, per-subreddit counts, `syncRuns` (per-origin
provenance), and `resumeCursors`. All commands emit JSON by default; pass
`--human` only for terminal display.

## Picking the Right Approach

- **Single fact / find one post** → `reddit-saved search "<query>"` (FTS5 over
  title/selftext/body/subreddit/author/flair/url). Add `--subreddit`,
  `--author`, `--min-score`, `--after`/`--before`, `--kind t1|t3`.
- **Topic dive / "what did I save about X"** → `reddit-saved research "<query>"`
  — deterministic markdown brief: seed matches, the stored discussion thread
  around each (including captured context), outbound links, subreddit counts.
  No AI, no network. Run `reddit-saved fetch context` first for richer threads.
- **"What was that link…" / shared-link lookup** →
  `reddit-saved links search <pattern>`, or
  `reddit-saved links top --window 90d --exclude-reddit` for "what have I been
  reading lately".
- **Year vibe / theme summary** → `reddit-saved list --after 2024-01-01
  --before 2025-01-01 --hide-low-quality --limit 10000` and read across the
  whole window. Do NOT shortcut with a top-N `--sort score` slice — that
  yields only viral peaks and misses recurring themes and everyday texture.
  Top-score slices are for spot-checks only.
- **"Did anyone reply / mention me?"** → `reddit-saved inbox` (local read;
  unread first). Filter with `--type comment_reply|post_reply|mention|message`
  and `--unread`. Sync first with `reddit-saved fetch inbox`.
- **Browse / filter** → `reddit-saved list` with the same filters as search
  plus `--origin saved|upvoted|submitted|commented|context` and `--tag`.
- **Bulk export for another tool** → `reddit-saved export --format
  json|csv|markdown`.
- **Refresh the cache** → `reddit-saved fetch --all` (all four origins,
  incremental) or `reddit-saved fetch --type saved --full` for a full resync.
  Requires auth (browser-extension session or OAuth).
- **Refresh everything at once** → `reddit-saved jobs run` (fetch all origins →
  capture context → sync inbox → backup, skipping backup when unconfigured).
  `reddit-saved jobs status` shows recent pipeline runs; a file lock makes
  overlapping runs skip cleanly. On macOS, `reddit-saved jobs install-launchd`
  schedules it hourly (`reddit-saved jobs uninstall-launchd` removes it) — so
  the archive is usually already fresh.

## Quality Filter

`--hide-low-quality` (on `search`, `list`, `export`; default-on inside
`research`) removes:

- deleted authors (`author = '[deleted]'`)
- removed/deleted text (`body`/`selftext` of `[deleted]` or `[removed]`)
- known bots (`AutoModerator`, `sneakpeekbot`)
- moderator-stickied comments
- low-value comments: kind `t1` with score < 1 AND body shorter than 60 chars

It preserves short high-score comments, media/link posts, and everything by
real authors. For vibe/summary work, always pass it.

## Thread Context

`reddit-saved fetch context` captures the conversation around saved items as
`content_origin = 'context'` rows: ancestor chains for saved comments, top
comments (score ≥ 3, up to 20) for saved posts. It processes 50 items per run
and is per-item resumable — rerun until `remaining` is 0.

Context rows are excluded from `list`/`search`/`export`/stats unless you pass
`--include-context` (or `--origin context`), and they never affect orphan
detection. `research` uses them automatically.

## Inbox

`reddit-saved fetch inbox` syncs the Reddit inbox (comment replies, post
replies, username mentions, private messages) into a dedicated `inbox_items`
table; `reddit-saved inbox` reads it offline. `is_new` mirrors Reddit's unread
flag as of the last sync — the tool never marks anything read on Reddit.
Replies and mentions are also stored as context rows, so they show up in
`research` threads and `search --include-context`.

## Trust & Completeness

Interpret coverage before making claims:

- `status` → `syncRuns[origin].lastRun` shows the latest run's mode, status
  (`complete`/`partial`/`errored`/`cancelled`), fetched count, and
  `lastCompleteFullAt`. No entry means that origin was never synced.
- **Saturation**: Reddit's API exposes only the newest ~1000 items per
  listing. A `saturated: true` run means orphan detection was skipped and
  items beyond the window cannot be verified — say "at least", not "all".
- `is_on_reddit = 0` rows (`--orphaned`) were unsaved or deleted on Reddit;
  they remain in the archive.
- Context coverage: saved rows with `context_fetched_at` NULL have no thread
  captured yet; `fetch context` reports `remaining`.

## Backup

Use when asked to preserve or restore the archive via git:

```bash
reddit-saved backup init --repo ~/backups/reddit-saved
reddit-saved backup sync
reddit-saved backup status
```

Backed up: posts (sharded by UTC year), tags, post_tags, sync_state,
inbox_items, and a timestamp-free manifest. Deterministic — an unchanged
database produces no commit. Not backed up: link_occurrences, sync_runs, FTS
tables (all derived; `reddit-saved links rebuild` regenerates the link index).

## Verification

After changing queries/filters, run focused tests first:

```bash
bun test packages/core/tests/sqlite-adapter.test.ts packages/core/tests/quality.test.ts
```

After link-index, backup, or research changes:

```bash
bun test packages/core/tests/link-index.test.ts packages/core/tests/backup.test.ts packages/core/tests/research-brief.test.ts
```

Then the full gate from the repo root:

```bash
bun run verify
```
