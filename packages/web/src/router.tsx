import {
  Outlet,
  RootRoute,
  Route,
  Router,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { queryClient } from "./lib/query-client";
import { BrowsePage } from "./pages/BrowsePage";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { PostPage } from "./pages/PostPage";
import { RootLayout } from "./pages/RootLayout";
import { SettingsPage } from "./pages/SettingsPage";
import type { BrowseFilters } from "./types";

const rootRoute = createRootRoute({
  component: () => (
    <RootLayout>
      <Outlet />
    </RootLayout>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

const browseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/browse",
  component: BrowsePage,
  validateSearch: (search: Record<string, unknown>): BrowseFilters => {
    const asNum = (v: unknown): number | undefined => {
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    const asPage = (v: unknown): number | undefined => {
      const n = Number(v);
      return Number.isInteger(n) && n > 1 ? n : undefined;
    };
    const asBool = (v: unknown): boolean | undefined =>
      v === "true" || v === true ? true : v === "false" || v === false ? false : undefined;
    const asStr = (v: unknown): string | undefined =>
      typeof v === "string" && v.length > 0 ? v : undefined;
    const origin = asStr(search.origin);
    const kind = asStr(search.kind);
    const sort = asStr(search.sort);
    const dir = asStr(search.dir);
    return {
      subreddit: asStr(search.subreddit),
      author: asStr(search.author),
      minScore: asNum(search.minScore),
      tag: asStr(search.tag),
      origin:
        origin === "saved" ||
        origin === "upvoted" ||
        origin === "submitted" ||
        origin === "commented"
          ? origin
          : undefined,
      kind: kind === "t1" || kind === "t3" ? kind : undefined,
      orphaned: asBool(search.orphaned),
      sort: sort === "created" || sort === "score" ? sort : undefined,
      dir: dir === "asc" || dir === "desc" ? dir : undefined,
      q: asStr(search.q),
      page: asPage(search.page),
    };
  },
});

const postRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/post/$id",
  component: PostPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  browseRoute,
  postRoute,
  settingsRoute,
  loginRoute,
]);

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  defaultPendingMs: 200,
});

export type { RootRoute, Route, Router };
