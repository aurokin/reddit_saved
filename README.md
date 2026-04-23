# Reddit Saved

Reddit Saved is a local-first archive for Reddit content. It fetches Reddit
listings into SQLite, then lets you browse, search, tag, export, and
selectively unsave against the local database instead of repeatedly walking
Reddit's paginated API.

## Quickstart

```bash
bun install
bun run --filter @reddit-saved/web seed
cd packages/web
TEST_MODE=1 bun run dev
```

Then open `http://localhost:3000`.

## Docs

- Start with [docs/README.md](./docs/README.md).
- Use [packages/web/README.md](./packages/web/README.md) for the local web
  workflow.
- Use [packages/extension/README.md](./packages/extension/README.md) for the
  companion browser extension.
