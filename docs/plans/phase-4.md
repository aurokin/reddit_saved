# Phase 4 — Web Implementation Plan

## Tech Stack (locked)

**Frontend**
- React 19
- TanStack Router 1 (code-based routing)
- TanStack Query 5
- Tailwind CSS v4 (`@variant dark` for dark mode)
- shadcn/ui + Radix primitives + Lucide icons
- `@tanstack/react-virtual` for long lists
- React state (no Zustand); React 19 Actions for forms
- Reddit `body_html` (sanitized) over client-side markdown parsing
- `Intl.RelativeTimeFormat` for timestamps

**API**
- Hono on `Bun.serve()`
- Single origin in prod (serves Vite `dist/` as SPA fallback for non-`/api/*` routes)
- Vite dev proxy `/api/*` → `:3001`
- Shared code with CLI: same `SqliteAdapter`, `TagManager`, `RedditApiClient`, `TokenManager`, `auth.lock`, SQLite file, sync checkpoint

**Tooling**
- Biome (lint + format) — root config covers web
- `bun test` + happy-dom + Testing Library (unit / component)
- Playwright (e2e, with auth bypass via seeded `auth.json` + `TEST_MODE` flag)

**Error / loading pattern**
- Global Suspense + ErrorBoundary
- `useSuspenseQuery` + Router pending / error boundaries as the default

**CSP**
- `img-src` / `media-src` allowlist: `i.redd.it`, `v.redd.it`, `preview.redd.it`, `external-preview.redd.it`, `a.thumbs.redditmedia.com`, `b.thumbs.redditmedia.com`

## 4.0 — Scaffolding

- Add deps: `hono`, `@tanstack/react-router`, `@tanstack/react-virtual`, `@tailwindcss/vite`, `lucide-react`, Radix primitives (`@radix-ui/react-dialog`, `-dropdown-menu`, `-popover`, `-slot`, `-tooltip`), `class-variance-authority`, `clsx`, `tailwind-merge`
- Dev deps: `@testing-library/react`, `@testing-library/jest-dom`, `happy-dom`, `@playwright/test`
- `vite.config.ts`: React + Tailwind v4 plugins, `/api/*` proxy to `:3001`, `@/` alias
- `index.html`, `src/main.tsx`, `src/styles/globals.css` (`@import "tailwindcss"` + `@theme`)
- shadcn setup (`components.json`, `lib/utils.ts`)
- `.gitignore`: `dev-data/`, `playwright-report/`, `test-results/`

## 4.1 — Dev seed script

- `packages/web/scripts/seed.ts`: generates ~200 `RedditItem` fixtures covering:
  - posts + comments
  - varied subreddits, scores, dates
  - markdown bodies
  - image / gallery / video / external link types
  - NSFW
  - ~10% orphaned (`is_on_reddit = 0`)
  - assorted tags
- Uses `SqliteAdapter.upsertPosts()` + `TagManager` against `./dev-data/reddit-saved.db`
- Idempotent — wipes and reseeds
- Script: `bun run seed`
- Doubles as Playwright test setup

## 4.2 — API server (Hono on `Bun.serve`)

`src/api/server.ts` boots Hono, opens shared `SqliteAdapter`, `TokenManager`, `RedditApiClient`. Respects existing `auth.lock`. Listens on `:3001`.

**Routes** (thin adapters over core):

- Auth
  - `GET /api/auth/status`
  - `POST /api/auth/login`
  - `POST /api/auth/logout`
- Posts
  - `GET /api/posts` — filters, sort, pagination
  - `GET /api/posts/:id`
  - `GET /api/posts/search`
- Tags
  - `GET /api/tags`
  - `POST /api/tags`
  - `PATCH /api/tags/:id`
  - `DELETE /api/tags/:id`
  - `POST /api/posts/:id/tags`
  - `DELETE /api/posts/:id/tags/:tag`
- Sync
  - `POST /api/sync/fetch` — streams progress via SSE
  - `GET /api/sync/status`
  - `POST /api/unsave`
- Export
  - `GET /api/export?format=json|csv|markdown`

**Middleware**
- CSP headers with Reddit CDN allowlist
- Error handler → JSON
- Structured logger

**Prod mode**: fallback to `dist/index.html` for non-`/api` requests.

**`TEST_MODE` env**: skips real OAuth, loads seeded `auth.json` — used by Playwright.

## 4.3 — SPA shell

- TanStack Router (code-based) in `src/router.tsx`: `__root`, `/`, `/browse`, `/post/$id`, `/settings`, `/login`
- Root layout: topbar (logo, global search, sync indicator, dark toggle, settings link), outlet; sidebar on `/browse` for filters
- Providers: QueryClient, RouterProvider, ErrorBoundary + Suspense fallback
- Dark mode: `localStorage` + `prefers-color-scheme`, Tailwind `@variant dark`

## 4.4 — Pages

- **Home (`/`)**: recent posts (virtualized), top subreddits, tag cloud, auth / sync status
- **Browse (`/browse`)**: `FilterPanel` (subreddit, author, score range, date range, tag, origin, type, orphaned) + sort + virtualized `PostList`. URL-synced filter state via Router search params
- **Post (`/post/$id`)**: sanitized `body_html`, media (`MediaEmbed`), metadata, tag editor, Reddit link, unsave button (requires confirm dialog)
- **Settings (`/settings`)**: auth status + re-login, sync trigger with SSE progress, DB stats, export, `TagManager` (CRUD + merge)
- **Login (`/login`)**: polled auth status during OAuth flow

## 4.5 — Components (`src/components/`)

- `PostCard`
- `PostList` (virtualized)
- `SearchBar` (debounced)
- `FilterPanel`
- `TagChips`
- `TagEditor`
- `TagManager`
- `SyncStatus`
- `MediaEmbed` (img / video / gallery / external link)
- `EmptyState`
- `ErrorState`
- `ConfirmDialog`
- shadcn primitives: Button, Input, Dialog, DropdownMenu, Popover, Tooltip, Badge, Separator, Skeleton

## 4.6 — Hooks (`src/hooks/`)

All use `useSuspenseQuery` by default:

- `usePosts`
- `useSearchPosts`
- `usePost`
- `useTags`
- `usePostTags`
- `useAuthStatus`
- `useSyncStatus` (SSE)
- `useExport`
- `useUnsave`

## 4.7 — Testing

**Component (`bun test` + happy-dom + Testing Library)**
- `PostCard`
- `FilterPanel`
- `TagEditor`
- `SearchBar`
- `SyncStatus`

**Playwright e2e (`packages/web/tests/e2e/`)**

Seed DB → start server in `TEST_MODE` → flows:
- Browse + filter
- FTS search
- Tag CRUD
- Post detail view
- Export
- Unsave-with-confirm

## 4.8 — Docs

- Update `docs/plans/architecture.md`: Phase 4 → complete, note Hono as web-only dep, include route list
- `packages/web/README.md`: `bun run seed`, `bun run dev`, `bun run test`, e2e instructions

## Milestones / Review Points

1. **4.0 + 4.1** — scaffolding + seed working, `bun run dev` serves empty SPA against seeded DB → **review**
2. **4.2 + hooks** — API routes + React Query hooks pass component tests → **review**
3. **4.3 + 4.4** — SPA shell + pages rendered against seeded DB, dark mode, virtualization
4. **4.5 polish + 4.7 e2e**
5. **4.8 docs + final review**

## Known Risks

- TanStack Router code-based scales awkwardly past ~10 routes — revisit file-based if page count grows
- Tailwind v4 component ecosystem still maturing; shadcn components may need minor adjustments
- SSE from Hono on Bun — verify backpressure behavior under long syncs
- Concurrent SQLite writes from CLI + web during sync: WAL + `busy_timeout` should cover it, but validate under load
- Playwright OAuth bypass introduces a `TEST_MODE` codepath that must stay off in prod — enforce via assertion at server start
