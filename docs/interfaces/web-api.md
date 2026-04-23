# Web API Reference

## Shape

The web package is a same-origin local app. The API and SPA are served from the
same machine and share the same SQLite database, auth files, and sync
machinery.

## Routes

| Area | Routes |
|---|---|
| Auth | `/api/auth/status`, `/api/auth/login`, `/api/auth/logout`, session endpoints |
| Posts | `/api/posts`, `/api/posts/search`, `/api/posts/:id`, post tag mutations |
| Tags | `/api/tags` CRUD |
| Sync | `/api/sync/status`, `/api/sync/fetch`, `/api/sync/cancel` |
| Actions | `/api/unsave`, `/api/export`, `/api/health` |

## Notes

- The API is intentionally thin and delegates domain behavior to `packages/core`.
- Sync progress is streamed over SSE.
- Non-`/api/*` routes belong to the SPA, not the API layer.
