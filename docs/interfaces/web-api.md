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
| Links | `/api/links` (top links; `since`, `excludeReddit`, `limit`), `/api/links/search?q=` |
| Today | `/api/today?hours=24` → deterministic digest + rendered markdown |
| Inbox | `/api/inbox` (`type`, `unread`, `limit`, `offset`; items carry `storedPostId` when mirrored into posts) |
| Jobs | `/api/jobs` → scheduled-pipeline run history |
| Sync | `/api/sync/status`, `/api/sync/runs`, `/api/sync/fetch` (SSE), `/api/sync/context` (SSE), `/api/sync/cancel` |
| Actions | `/api/unsave`, `/api/export`, `/api/health` |

## Notes

- The API is intentionally thin and delegates domain behavior to `packages/core`.
- Sync progress is streamed over SSE.
- Non-`/api/*` routes belong to the SPA, not the API layer.
