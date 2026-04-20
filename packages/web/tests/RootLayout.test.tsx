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
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SyncStreamProvider, usePost, usePosts, useSearchPosts } from "@/hooks/queries";
import { SyncStatus } from "@/components/SyncStatus";
import { RootLayout } from "@/pages/RootLayout";
import type { BrowseFilters } from "@/types";

const originalFetch = globalThis.fetch;
const originalEventSource = globalThis.EventSource;

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
}

function validateBrowseSearch(search: Record<string, unknown>): BrowseFilters {
  const asPage = (value: unknown): number | undefined => {
    const page = Number(value);
    return Number.isInteger(page) && page > 1 ? page : undefined;
  };
  const asStr = (value: unknown): string | undefined =>
    typeof value === "string" && value.length > 0 ? value : undefined;

  return {
    author: asStr(search.author),
    q: asStr(search.q),
    page: asPage(search.page),
  };
}

function BrowseSearchState() {
  const search = useSearch({ from: "/browse" }) as BrowseFilters;
  return <pre data-testid="browse-search">{JSON.stringify(search)}</pre>;
}


function makeSyncStatus() {
  return {
    isRunning: false,
    lastSyncTime: null,
    lastFullSyncTime: null,
    incrementalCursors: {},
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

function SyncPage() {
  const navigate = useNavigate();

  return (
    <div>
      <SyncStatus />
      <button onClick={() => void navigate({ to: "/settings" })}>Go to settings</button>
    </div>
  );
}

function PostsProbe() {
  usePosts({ limit: 50 });
  useSearchPosts({ limit: 50, q: "rust" });
  return null;
}

function PostProbe() {
  usePost("post1");
  return null;
}

function SyncPostsPage() {
  return (
    <div>
      <SyncStatus />
      <PostsProbe />
      <PostProbe />
    </div>
  );
}

function SettingsPage() {
  return <div data-testid="settings-page">Settings page</div>;
}

function renderSyncLayout(path: string): void {
  const queryClient = makeClient();
  const rootRoute = createRootRoute({
    component: () => (
      <RootLayout>
        <Outlet />
      </RootLayout>
    ),
  });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: SyncPage,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    component: SettingsPage,
  });
  const routeTree = rootRoute.addChildren([homeRoute, settingsRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <SyncStreamProvider>
        <RouterProvider router={router} />
      </SyncStreamProvider>
    </QueryClientProvider>,
  );
}

class MockEventSource {
  static latest: MockEventSource | null = null;
  closeCalls = 0;
  private listeners = new Map<string, Array<(event: MessageEvent) => void>>();

  constructor(public readonly url: string | URL) {
    MockEventSource.latest = this;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (!listener) return;
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(
      typeof listener === "function"
        ? (listener as (event: MessageEvent) => void)
        : ((event: MessageEvent) => listener.handleEvent(event)),
    );
    this.listeners.set(type, listeners);
  }

  close(): void {
    this.closeCalls += 1;
  }

  emit(type: string, data: Record<string, unknown>): void {
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

function renderRootLayout(path: string): void {
  const queryClient = makeClient();
  const rootRoute = createRootRoute({
    component: () => (
      <RootLayout>
        <Outlet />
      </RootLayout>
    ),
  });
  const browseRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/browse",
    component: BrowseSearchState,
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
      <SyncStreamProvider>
        <RouterProvider router={router} />
      </SyncStreamProvider>
    </QueryClientProvider>,
  );
}

describe("RootLayout header search", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.EventSource = originalEventSource;
    MockEventSource.latest = null;
  });

  test("clearing a browse query removes q while preserving other browse filters", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(rawUrl, "http://localhost");
      if (url.pathname === "/api/sync/status") {
        return Response.json({
          isRunning: false,
          lastSyncTime: null,
          lastFullSyncTime: null,
          incrementalCursors: {},
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
        });
      }
      throw new Error(`Unexpected fetch: ${rawUrl}`);
    }) as unknown as typeof fetch;

    renderRootLayout("/browse?author=alice&page=2");

    const input = (await screen.findByTestId("search-input")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "rust" } });

    await waitFor(() => {
      expect(screen.getByTestId("browse-search").textContent).toBe('{"author":"alice","q":"rust"}');
    });

    fireEvent.change(input, { target: { value: "" } });

    await waitFor(() => {
      expect(screen.getByTestId("browse-search").textContent).toBe('{"author":"alice"}');
    });
  });


  test("keeps the sync stream alive when the page-level status unmounts", async () => {
    let cancelCalls = 0;

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(rawUrl, "http://localhost");
      if (url.pathname === "/api/sync/status") {
        return Response.json(makeSyncStatus());
      }
      if (url.pathname === "/api/sync/cancel" && init?.method === "POST") {
        cancelCalls += 1;
        return Response.json({ ok: true });
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${rawUrl}`);
    }) as unknown as typeof fetch;
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;

    renderSyncLayout("/");

    fireEvent.click(await screen.findByTestId("sync-now"));

    await waitFor(() => expect(MockEventSource.latest).not.toBeNull());
    act(() => {
      MockEventSource.latest?.emit("progress", { fetched: 12 });
    });

    await waitFor(() => {
      expect(screen.getAllByText("fetching (12)").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole("button", { name: "Go to settings" }));

    await screen.findByTestId("settings-page");
    expect(MockEventSource.latest?.closeCalls).toBe(0);
    expect(cancelCalls).toBe(0);
    expect(screen.queryByRole("button", { name: "Sync now" })).toBeNull();

    await waitFor(() => {
      expect(screen.getAllByText("fetching (12)").length).toBeGreaterThan(0);
    });
  });

  test("complete sync refetches active list, search, and post-detail queries", async () => {
    let listCalls = 0;
    let searchCalls = 0;
    let postCalls = 0;

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(rawUrl, "http://localhost");
      if (url.pathname === "/api/sync/status") {
        return Response.json(makeSyncStatus());
      }
      if (url.pathname === "/api/posts/search") {
        searchCalls += 1;
        return Response.json({ items: [], total: 0, query: "rust", limit: 50, offset: 0 });
      }
      if (url.pathname === "/api/posts") {
        listCalls += 1;
        return Response.json({ items: [], total: 0, limit: 50, offset: 0 });
      }
      if (url.pathname === "/api/posts/post1") {
        postCalls += 1;
        return Response.json({
          id: "post1",
          title: "Saved post",
          author: "alice",
          subreddit: "typescript",
          permalink: "/r/typescript/comments/post1/saved_post/",
          url: "https://reddit.com/r/typescript/comments/post1/saved_post/",
          contentType: "post",
          score: 1,
          createdUtc: 1,
          savedAt: 1,
          isOrphaned: false,
          contentOrigin: "saved",
          previewText: null,
          thumbnailUrl: null,
          domain: "reddit.com",
        });
      }
      throw new Error(`Unexpected fetch: ${rawUrl}`);
    }) as unknown as typeof fetch;
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;

    const queryClient = makeClient();
    const rootRoute = createRootRoute({
      component: () => (
        <RootLayout>
          <Outlet />
        </RootLayout>
      ),
    });
    const homeRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      component: SyncPostsPage,
    });
    const routeTree = rootRoute.addChildren([homeRoute]);
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/"] }),
      context: { queryClient },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <SyncStreamProvider>
          <RouterProvider router={router} />
        </SyncStreamProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(listCalls).toBe(1));
    await waitFor(() => expect(searchCalls).toBe(1));
    await waitFor(() => expect(postCalls).toBe(1));

    fireEvent.click(await screen.findByTestId("sync-now"));
    await waitFor(() => expect(MockEventSource.latest).not.toBeNull());

    act(() => {
      MockEventSource.latest?.emit("complete", { fetched: 1, hasMore: false, orphaned: 0 });
    });

    await waitFor(() => expect(listCalls).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(searchCalls).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(postCalls).toBeGreaterThanOrEqual(2));
    expect(MockEventSource.latest?.closeCalls).toBe(1);
  });

  test("cancel refetches sync status and active posts queries even without incomplete SSE", async () => {
    let statusCalls = 0;
    let listCalls = 0;
    let searchCalls = 0;
    let cancelCalls = 0;

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(rawUrl, "http://localhost");
      if (url.pathname === "/api/sync/status") {
        statusCalls += 1;
        return Response.json(makeSyncStatus());
      }
      if (url.pathname === "/api/posts/search") {
        searchCalls += 1;
        return Response.json({ items: [], total: 0, query: "rust", limit: 50, offset: 0 });
      }
      if (url.pathname === "/api/posts") {
        listCalls += 1;
        return Response.json({ items: [], total: 0, limit: 50, offset: 0 });
      }
      if (url.pathname === "/api/sync/cancel" && init?.method == "POST") {
        cancelCalls += 1;
        return Response.json({ ok: true });
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${rawUrl}`);
    }) as unknown as typeof fetch;
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;

    const queryClient = makeClient();
    const rootRoute = createRootRoute({
      component: () => (
        <RootLayout>
          <Outlet />
        </RootLayout>
      ),
    });
    const homeRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      component: SyncPostsPage,
    });
    const routeTree = rootRoute.addChildren([homeRoute]);
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/"] }),
      context: { queryClient },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <SyncStreamProvider>
          <RouterProvider router={router} />
        </SyncStreamProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(statusCalls).toBe(1));
    await waitFor(() => expect(listCalls).toBe(1));
    await waitFor(() => expect(searchCalls).toBe(1));

    fireEvent.click(await screen.findByTestId("sync-now"));
    await waitFor(() => expect(MockEventSource.latest).not.toBeNull());
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(cancelCalls).toBe(1));
    await waitFor(() => expect(statusCalls).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(listCalls).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(searchCalls).toBeGreaterThanOrEqual(2));
    expect(MockEventSource.latest?.closeCalls).toBe(1);
  });

});
