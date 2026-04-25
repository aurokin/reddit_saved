# CLI Reference

## Entry Point

```text
reddit-saved
```

## Commands

```text
reddit-saved auth login [--open-browser]
reddit-saved auth status|logout
reddit-saved fetch [--full] [--type saved|upvoted|submitted|commented] [--limit N]
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
- Auth commands use the same local auth/session files as the web app.
- `auth login` prints the Reddit authorization URL by default. Pass
  `--open-browser` or set `REDDIT_SAVED_OPEN_BROWSER=1` to launch it
  automatically.
