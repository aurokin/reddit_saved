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
reddit-saved search <query> [filters...]
reddit-saved list [filters...]
reddit-saved export [--format json|csv|markdown] [filters...]
reddit-saved status
reddit-saved unsave [selectors...] [--dry-run] --confirm
reddit-saved tag list|create|rename|delete|add|remove|show
```

## Notes

- The CLI is the operator and automation surface over the shared local SQLite
  database.
- JSON-oriented output is the default shape for composable usage.
- CLI auth commands manage the legacy OAuth file, `auth.json`. The web app's
  companion-extension session files, `session.json` and `session.blocked.json`,
  are managed from the local web app.
- `auth login` prints the Reddit authorization URL by default. Pass
  `--open-browser` or set `REDDIT_SAVED_OPEN_BROWSER=1` to launch it
  automatically.
- `auth logout` clears OAuth credentials only; it does not disconnect the web
  companion-extension session.
- `fetch --all` runs every content type sequentially; a failing type does not
  abort the rest, and the exit code is 1 if any type errored.
- Each fetch writes a per-origin resume checkpoint
  (`.reddit-import-checkpoint.<origin>.json` next to the database) and records
  provenance in the `sync_runs` table; `status` reports the latest run per
  origin, including saturation (Reddit exposes only the newest ~1000 items per
  listing).
