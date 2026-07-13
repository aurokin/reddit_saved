# Reddit Cached

Reddit Cached is a local-first archive for Reddit content. It fetches Reddit
listings into SQLite, then lets you browse, search, tag, export, and
selectively unsave against the local database instead of repeatedly walking
Reddit's paginated API.

## Quickstart (seeded demo, no Reddit account)

```bash
bun install
bun run --filter @reddit-cached/web seed
cd packages/web
TEST_MODE=1 bun run dev
```

Then open `http://localhost:3000`. TEST_MODE uses fixture data and disables
real Reddit sync.

## Real usage (your Reddit account)

```bash
bun install
cd packages/web
bun run build
bun run start
```

Then open `http://127.0.0.1:3001` and connect your Reddit session:

1. Install the companion extension — see
   [packages/extension/README.md](./packages/extension/README.md). It forwards
   your reddit.com session cookies to the local app (session auth is the
   primary mode; OAuth is a legacy fallback).
2. Once the app shows you as connected, run a sync from the UI, or use the CLI
   (`bun run dev:cli -- fetch` from the repo root).
3. Search locally via the UI, or `bun run dev:cli -- search <query>` —
   CLI output is JSON by default, so it's directly usable by scripts and
   agents.

The database lives in the platform data directory (macOS:
`~/Library/Application Support/reddit-saved/reddit-saved.db`); override with
`REDDIT_SAVED_DB=<path>`.

## Verification

```bash
bun install
bun run verify
```

## Docs

- Start with [docs/README.md](./docs/README.md).
- Use [packages/web/README.md](./packages/web/README.md) for the local web
  workflow.
- Use [packages/extension/README.md](./packages/extension/README.md) for the
  companion browser extension.
