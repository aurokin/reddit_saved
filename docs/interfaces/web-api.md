# Web API Reference

## Shape

The web package is a same-origin local app. The API and SPA are served from the
same machine and share the same SQLite database, auth files, and sync
machinery.

## Routes

| Area | Routes |
|---|---|
| Auth | `/api/auth/status`, `POST /api/auth/login`, `POST /api/auth/logout`, `POST/GET/DELETE /api/auth/session`, `POST /api/auth/session/clear`, `POST /api/auth/session/reconnect` |
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
- `POST /api/auth/session` is the browser extension's cookie-forwarding
  ingestion endpoint; it rejects with `401 SESSION_INVALID` or
  `409 SESSION_BLOCKED`.
- Sync progress is streamed over SSE.
- Non-`/api/*` routes belong to the SPA, not the API layer.
