# @reddit-saved/web

The SPA + API surface for the Reddit-Saved monorepo. It is a local-only tool: the
React 19 app and the Hono/Bun.serve() API run side-by-side on your machine and
talk to the same SQLite database the CLI uses.

## Stack

- **Frontend**: React 19 + Vite, TanStack Router (code-based), TanStack Query,
  TanStack Virtual, Tailwind v4, hand-rolled shadcn/ui primitives over Radix UI.
- **API**: Hono 4 on `Bun.serve()`, reusing `@reddit-saved/core` for storage,
  tags, OAuth, and the Reddit API client. Progress streams over SSE.
- **Tests**: `bun test` + `happy-dom` + `@testing-library/react` for unit/component
  tests; Playwright for e2e.

## Getting started

```bash
# From the repo root, install deps (already wired via bun workspaces)
bun install

# One-time: populate a dev database with 200 fixture posts
bun run --filter @reddit-saved/web seed

# Start dev mode (Vite :3000 + API :3001) in TEST_MODE so no Reddit writes happen
# The server reads from packages/web/dev-data/reddit-saved.db
cd packages/web
TEST_MODE=1 bun run dev
```

Open http://localhost:3000. The Vite dev server proxies `/api/*` to the Hono
server on `:3001`.

### Production

```bash
cd packages/web
bun run build           # emits dist/ via Vite
bun run start           # single-process server on :3001 that serves dist/ + API
```

In production mode the API server:

- Serves `dist/` assets directly.
- Falls back to `dist/index.html` for any non-`/api/*` request so client-side
  routes (`/browse`, `/post/:id`) resolve.
- Applies a CSP that allows Reddit's media CDN hosts (`i.redd.it`, `v.redd.it`,
  `preview.redd.it`, `external-preview.redd.it`, `*.thumbs.redditmedia.com`) —
  needed because `MediaEmbed` renders previews inline.

### Authentication

Reddit closed self-service API app registrations in 2024, so this app supports
two auth modes — pick whichever works for your account:

1. **Companion browser extension (default for new users)**. Install
   `packages/extension` as an unpacked Chrome add-on or build its Firefox
   variant first (see its `README.md`). On install, on reddit.com cookie
   changes, and every 30 minutes the extension forwards your reddit.com cookies
   + `x-modhash` to `POST <your configured local app URL>/api/auth/session`.
   The server stores them in `~/.config/reddit-saved/session.json` (mode 0600,
   never sent off-machine) and routes API calls through `www.reddit.com/.json`
   endpoints with `Cookie` auth.
2. **OAuth (legacy)**. If you already have a registered Reddit OAuth app, set
   `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` and start the flow from
   `/login`. Tokens land in `~/.config/reddit-saved/auth.json`.

When both files exist the session takes precedence — `CompositeAuthProvider` in
`api/context.ts` picks Session first, OAuth second. Disconnect either from
the Settings page.

### TEST_MODE

`TEST_MODE=1` disables Reddit writes and stubs OAuth so Playwright and local dev
sessions never hit reddit.com. The package scripts point the server at
`./dev-data/reddit-saved.db`, and Playwright reseeds that file before startup.
It is a hard error to run it under
`NODE_ENV=production` — the server asserts this at boot. `/api/unsave` and
`/api/sync/fetch` both refuse to run against Reddit while in test mode.

## Layout

```
packages/web/
├── index.html                 # SPA entry with inline dark-mode FOUC script
├── scripts/seed.ts            # Deterministic 200-item fixture
├── src/
│   ├── main.tsx               # React root: QueryClientProvider + RouterProvider
│   ├── router.tsx             # Code-based TanStack Router + search validators
│   ├── api/
│   │   ├── server.ts          # Hono app; mounts /api/* and serves dist in prod
│   │   ├── context.ts         # Singleton bootstrap of core (storage/tags/oauth/client)
│   │   ├── middleware.ts      # CSP + logger + error handler
│   │   └── routes/            # auth, posts, tags, sync (SSE), export
│   ├── pages/                 # RootLayout + Home/Browse/Post/Settings/Login
│   ├── components/
│   │   ├── ui/                # shadcn primitives (hand-rolled over Radix)
│   │   └── *.tsx              # PostCard, FilterPanel, SyncStatus, …
│   ├── hooks/queries.ts       # React Query + EventSource SSE hooks
│   ├── lib/                   # api-client, query-client, utils
│   └── styles/globals.css     # Tailwind v4 + @theme tokens + dark variant
└── tests/
    ├── setup.ts               # Registers happy-dom before bun test runs files
    ├── *.test.tsx             # Component tests
└── tests-e2e/
    └── smoke.spec.ts          # Playwright smoke suite (separate dir so bun test skips it)
```

## Routing & filter state

`router.tsx` uses TanStack Router in code-based mode. The `/browse` route
`validateSearch` turns URL query params into a typed `BrowseFilters` object, so
every filter interaction produces a shareable URL. The BrowsePage reads filters
via `useSearch({ from: "/browse" })` and writes them back with
`navigate({ search: ... })`. Pagination is URL-backed as well, so filters,
search text, and page number remain shareable.

## Sync progress (SSE)

`GET /api/sync/fetch` is implemented with Hono's `streamSSE`. The client uses
`EventSource` (which is GET-only) to subscribe. The route temporarily swaps the
core `RedditApiClient` callbacks via `setCallbacks` so per-page progress, rate
limit notices, retries, and errors reach the stream without exposing private
state. `/api/sync/cancel` aborts the in-flight sync via a shared `AbortController`.

## Testing

Component tests boot happy-dom via `tests/setup.ts`. The package-local
`bunfig.toml` keeps `bun run --filter @reddit-saved/web test` working, and the
test files import the same setup directly so repo-level `bun test` works too.
`tests/render.tsx` exports two helpers:

- `renderWithClient` for components that need only `QueryClientProvider`.
- `renderWithRouter` for components that depend on `<Link>` / `useSearch`.

Run them with:

```bash
bun test                # component tests
bunx playwright test    # e2e (reseeds ./dev-data/reddit-saved.db, then auto-starts dev server under TEST_MODE)
```

Typecheck:

```bash
bun run typecheck
```

## Scripts

| Script | What it does |
|---|---|
| `bun run dev` | Runs Vite (:3000) and the Hono API (:3001) concurrently against `./dev-data/reddit-saved.db` |
| `bun run dev:server` | API only, with `bun --watch`, against `./dev-data/reddit-saved.db` |
| `bun run dev:server:test` | API only, with `TEST_MODE=1`, against `./dev-data/reddit-saved.db` |
| `bun run build` | Vite production build to `dist/` |
| `bun run start` | Serves the built SPA + API on `:3001` |
| `bun run seed` | Populates `./dev-data/reddit-saved.db` with 200 fixtures |
| `bun run test` | bun test + happy-dom component tests |
| `bun run test:e2e` | Playwright smoke suite |
| `bun run typecheck` | `tsc --noEmit` |

## Notes

- **Hand-rolled shadcn**: We do not run the shadcn CLI. `src/components/ui/*`
  ships the primitives we use (Button, Dialog, DropdownMenu, Popover, Tooltip,
  Badge, Input, Skeleton, Separator), each wired to Radix where applicable.
- **Tailwind v4**: `@import "tailwindcss"` + `@theme` tokens. Dark mode is a
  class-based `@variant dark` toggled by `DarkModeToggle`, with an inline script
  in `index.html` that applies the class before paint to avoid FOUC.
- **No route-level data loaders**: Pages fetch through React Query hooks so they
  can show per-section skeletons/errors. The plan's `defaultPreload: "intent"`
  is enabled on the router so link hovers warm caches.
