import "./setup";
import { afterEach, describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BrowseFilters, SyncState } from "@/types";
import { BrowsePage } from "@/pages/BrowsePage";

const originalFetch = globalThis.fetch;

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
}

function validateBrowseSearch(search: Record<string, unknown>): BrowseFilters {
  const asStr = (value: unknown): string | undefined =>
    typeof value === "string" && value.length > 0 ? value : undefined;
  const pageNum = Number(search.page);
  return {
    q: asStr(search.q),
    page: Number.isInteger(pageNum) && pageNum > 1 ? pageNum : undefined,
  };
}

function renderBrowsePage(path: string): void {
  const queryClient = makeClient();
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const browseRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/browse",
    component: BrowsePage,
    validateSearch: validateBrowseSearch,
  });
  const routeTree = rootRoute.addChildren([browseRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

function makeSyncStatus() {
  return {
    isRunning: false,
    lastSyncTime: null,
    lastFullSyncTime: null,
    incrementalCursors: {} as SyncState["incrementalCursors"],
    stats: {
      totalPosts: 0,
      totalComments: 0,
      orphanedCount: 0,
      activeCountByOrigin: { saved: 0, upvoted: 0, submitted: 0, commented: 0 },
      subredditCounts: [],
      tagCounts: [],
      oldestItem: null,
      newestItem: null,
      lastSyncTime: null,
    },
  };
}

describe("BrowsePage pagination", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("shows page controls for multi-page browse results and requests the next offset", async () => {
    const listOffsets: number[] = [];

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(rawUrl, "http://localhost");

      if (url.pathname === "/api/tags") {
        return Response.json({ items: [] });
      }
      if (url.pathname === "/api/sync/status") {
        return Response.json(makeSyncStatus());
      }
      if (url.pathname === "/api/posts") {
        const offset = Number(url.searchParams.get("offset") ?? "0");
        listOffsets.push(offset);
        return Response.json({
          items: [{ id: `post-${offset}`, title: "Paged item" }],
          total: 120,
          limit: 50,
          offset,
        });
      }
      throw new Error(`Unexpected fetch: ${rawUrl}`);
    }) as unknown as typeof fetch;

    renderBrowsePage("/browse");

    expect(await screen.findByText("120 total")).toBeDefined();
    expect(screen.getByText("Page 1 of 3")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => expect(listOffsets.includes(50)).toBe(true));
    await waitFor(() => expect(screen.getByText("Page 2 of 3")).toBeDefined());
  });

  test("uses the API-reported search total instead of the current page item count", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(rawUrl, "http://localhost");

      if (url.pathname === "/api/tags") {
        return Response.json({ items: [] });
      }
      if (url.pathname === "/api/sync/status") {
        return Response.json(makeSyncStatus());
      }
      if (url.pathname === "/api/posts/search") {
        const offset = Number(url.searchParams.get("offset") ?? "0");
        return Response.json({
          items: [{ id: `search-${offset}`, title: "Rust result", snippet: "Rust snippet" }],
          total: 75,
          query: "rust",
          limit: 50,
          offset,
        });
      }
      if (url.pathname === "/api/posts") {
        return Response.json({ items: [], total: 0, limit: 50, offset: 0 });
      }
      throw new Error(`Unexpected fetch: ${rawUrl}`);
    }) as unknown as typeof fetch;

    renderBrowsePage("/browse?q=rust&page=2");

    expect(await screen.findByText("75 matches")).toBeDefined();
    expect(screen.getByText("Page 2 of 2")).toBeDefined();
  });

  test("does not reset search pagination when the query is unchanged", async () => {
    const listOffsets: number[] = [];
    const searchOffsets: number[] = [];

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(rawUrl, "http://localhost");

      if (url.pathname === "/api/tags") {
        return Response.json({ items: [] });
      }
      if (url.pathname === "/api/sync/status") {
        return Response.json(makeSyncStatus());
      }
      if (url.pathname === "/api/posts/search") {
        const offset = Number(url.searchParams.get("offset") ?? "0");
        searchOffsets.push(offset);
        return Response.json({
          items: [{ id: `search-${offset}`, title: "Rust result", snippet: "Rust snippet" }],
          total: 75,
          query: "rust",
          limit: 50,
          offset,
        });
      }
      if (url.pathname === "/api/posts") {
        const offset = Number(url.searchParams.get("offset") ?? "0");
        listOffsets.push(offset);
        return Response.json({ items: [], total: 0, limit: 50, offset });
      }
      throw new Error(`Unexpected fetch: ${rawUrl}`);
    }) as unknown as typeof fetch;

    renderBrowsePage("/browse?q=rust&page=2");

    expect(await screen.findByText("Page 2 of 2")).toBeDefined();

    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(screen.getByText("Page 2 of 2")).toBeDefined();
    expect(searchOffsets).toEqual([50]);
    expect(listOffsets).toEqual([50]);
  });

  test("clamps a stale browse page to the last available page", async () => {
    const listOffsets: number[] = [];

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(rawUrl, "http://localhost");

      if (url.pathname === "/api/tags") {
        return Response.json({ items: [] });
      }
      if (url.pathname === "/api/sync/status") {
        return Response.json(makeSyncStatus());
      }
      if (url.pathname === "/api/posts") {
        const offset = Number(url.searchParams.get("offset") ?? "0");
        listOffsets.push(offset);
        if (offset >= 75) {
          return Response.json({ items: [], total: 75, limit: 50, offset });
        }
        return Response.json({
          items: [{ id: `post-${offset}`, title: "Paged item" }],
          total: 75,
          limit: 50,
          offset,
        });
      }
      throw new Error(`Unexpected fetch: ${rawUrl}`);
    }) as unknown as typeof fetch;

    renderBrowsePage("/browse?page=999");

    await waitFor(() => expect(listOffsets.includes(49900)).toBe(true));
    await waitFor(() => expect(listOffsets.includes(50)).toBe(true));
    expect(await screen.findByText("Page 2 of 2")).toBeDefined();
    expect(screen.queryByText("Nothing matches those filters")).toBeNull();
  });

  test("clamps a stale search page to the last available page", async () => {
    const searchOffsets: number[] = [];

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(rawUrl, "http://localhost");

      if (url.pathname === "/api/tags") {
        return Response.json({ items: [] });
      }
      if (url.pathname === "/api/sync/status") {
        return Response.json(makeSyncStatus());
      }
      if (url.pathname === "/api/posts/search") {
        const offset = Number(url.searchParams.get("offset") ?? "0");
        searchOffsets.push(offset);
        if (offset >= 75) {
          return Response.json({ items: [], total: 75, query: "rust", limit: 50, offset });
        }
        return Response.json({
          items: [{ id: `search-${offset}`, title: "Rust result", snippet: "Rust snippet" }],
          total: 75,
          query: "rust",
          limit: 50,
          offset,
        });
      }
      if (url.pathname === "/api/posts") {
        const offset = Number(url.searchParams.get("offset") ?? "0");
        return Response.json({ items: [], total: 0, limit: 50, offset });
      }
      throw new Error(`Unexpected fetch: ${rawUrl}`);
    }) as unknown as typeof fetch;

    renderBrowsePage("/browse?q=rust&page=999");

    await waitFor(() => expect(searchOffsets.includes(49900)).toBe(true));
    await waitFor(() => expect(searchOffsets.includes(50)).toBe(true));
    expect(await screen.findByText("Page 2 of 2")).toBeDefined();
    expect(screen.queryByText("No results")).toBeNull();
  });
});
