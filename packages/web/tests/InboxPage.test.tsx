import "./setup";
import { afterEach, describe, expect, test } from "bun:test";
import { InboxPage } from "@/pages/InboxPage";
import type { InboxItemRow } from "@/types";
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
import { act } from "react";

const originalFetch = globalThis.fetch;

type InboxApiItem = InboxItemRow & { storedPostId: string | null };

function makeItem(
  id: string,
  overrides: Partial<Pick<InboxApiItem, "type" | "is_new" | "storedPostId" | "context">> = {},
): InboxApiItem {
  return {
    id,
    name: `t1_${id}`,
    kind: "t1",
    type: overrides.type ?? "comment_reply",
    author: "replier",
    subject: "comment reply",
    body: "hello there",
    dest: "me",
    subreddit: "test",
    context: overrides.context ?? `/r/test/comments/parent/x/${id}/?context=3`,
    link_title: "A post",
    parent_id: null,
    first_message_name: null,
    created_utc: 1_700_000_000,
    is_new: overrides.is_new ?? 0,
    fetched_at: 1_700_000_000_000,
    updated_at: 1_700_000_000_000,
    raw_json: "{}",
    storedPostId: overrides.storedPostId ?? null,
  };
}

function mockApi(items: InboxApiItem[]): { calls: string[] } {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    // Honor limit/offset so pagination tests exercise real slicing.
    const params = new URL(url, "http://localhost").searchParams;
    const offset = Number(params.get("offset") ?? 0);
    const limit = Number(params.get("limit") ?? items.length);
    return new Response(
      JSON.stringify({
        items: items.slice(offset, offset + limit),
        total: items.length,
        unreadCount: items.filter((i) => i.is_new === 1).length,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  return { calls };
}

let currentRouter: ReturnType<typeof createRouter> | null = null;

function renderInboxPage(path = "/inbox"): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const inboxRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/inbox",
    component: InboxPage,
    validateSearch: (search: Record<string, unknown>) => ({
      type:
        search.type === "comment_reply" ||
        search.type === "post_reply" ||
        search.type === "mention" ||
        search.type === "message"
          ? search.type
          : undefined,
      unread: search.unread === true || search.unread === "true" ? true : undefined,
      page:
        Number.isInteger(Number(search.page)) && Number(search.page) > 1
          ? Number(search.page)
          : undefined,
    }),
  });
  const postRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/post/$id",
    component: () => null,
  });
  const routeTree = rootRoute.addChildren([inboxRoute, postRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient },
  });
  currentRouter = router as unknown as ReturnType<typeof createRouter>;

  act(() => {
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  });
}

describe("InboxPage", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    currentRouter = null;
  });

  test("emphasizes unread rows", async () => {
    mockApi([makeItem("u1", { is_new: 1 }), makeItem("r1")]);
    renderInboxPage();

    await waitFor(() => expect(screen.getAllByTestId("inbox-row")).toHaveLength(2));
    const rows = screen.getAllByTestId("inbox-row");
    expect(rows[0].getAttribute("data-unread")).toBe("true");
    expect(rows[1].getAttribute("data-unread")).toBeNull();
    expect(screen.getByTestId("inbox-page-unread").textContent).toBe("1 unread");
  });

  test("clicking a tab syncs the type filter into the URL", async () => {
    const { calls } = mockApi([makeItem("m1", { type: "message" })]);
    renderInboxPage();

    await waitFor(() => expect(screen.getByTestId("inbox-tab-message")).toBeTruthy());
    fireEvent.click(screen.getByTestId("inbox-tab-message"));

    await waitFor(() => expect(currentRouter?.state.location.search).toEqual({ type: "message" }));
    await waitFor(() =>
      expect(calls.some((u) => u.includes("/api/inbox") && u.includes("type=message"))).toBe(true),
    );
  });

  test("initial type filter comes from the URL", async () => {
    const { calls } = mockApi([makeItem("m1", { type: "mention" })]);
    renderInboxPage("/inbox?type=mention");

    await waitFor(() =>
      expect(calls.some((u) => u.includes("/api/inbox") && u.includes("type=mention"))).toBe(true),
    );
  });

  test("paginates with prev/next buttons and a range indicator", async () => {
    const items = Array.from({ length: 60 }, (_, i) => makeItem(`pg${i}`));
    mockApi(items);
    renderInboxPage();

    await waitFor(() => expect(screen.getAllByTestId("inbox-row")).toHaveLength(50));
    expect(screen.getByTestId("inbox-range").textContent).toBe("1–50 of 60");
    expect((screen.getByTestId("inbox-prev") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("inbox-next") as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByTestId("inbox-next"));

    await waitFor(() => expect(currentRouter?.state.location.search).toEqual({ page: 2 }));
    await waitFor(() => expect(screen.getAllByTestId("inbox-row")).toHaveLength(10));
    expect(screen.getByTestId("inbox-range").textContent).toBe("51–60 of 60");
    expect((screen.getByTestId("inbox-prev") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId("inbox-next") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByTestId("inbox-prev"));
    await waitFor(() => expect(currentRouter?.state.location.search).toEqual({}));
    await waitFor(() => expect(screen.getByTestId("inbox-range").textContent).toBe("1–50 of 60"));
  });

  test("clamps an out-of-range page back to the last page with items", async () => {
    const items = Array.from({ length: 10 }, (_, i) => makeItem(`cl${i}`));
    mockApi(items);
    renderInboxPage("/inbox?page=3");

    // All 10 items fit on page 1, so ?page=3 gets replaced with page 1 —
    // never the misleading "Inbox is empty" state or a "101–100 of 10" range.
    await waitFor(() => expect(currentRouter?.state.location.search).toEqual({}));
    await waitFor(() => expect(screen.getAllByTestId("inbox-row")).toHaveLength(10));
    expect(screen.getByTestId("inbox-range").textContent).toBe("1–10 of 10");
    expect(screen.queryByText("Inbox is empty")).toBeNull();
  });

  test("hides pagination controls when the inbox is empty", async () => {
    mockApi([]);
    renderInboxPage();

    await waitFor(() => expect(screen.getByText("Inbox is empty")).toBeTruthy());
    expect(screen.queryByTestId("inbox-prev")).toBeNull();
    expect(screen.queryByTestId("inbox-next")).toBeNull();
  });

  test("rows link locally when mirrored, externally otherwise", async () => {
    mockApi([
      makeItem("local1", { storedPostId: "local1" }),
      makeItem("remote1", { type: "message", storedPostId: null }),
    ]);
    renderInboxPage();

    await waitFor(() => expect(screen.getAllByTestId("inbox-row")).toHaveLength(2));
    expect(screen.getByTestId("inbox-row-local")).toBeTruthy();
    const external = screen.getByTestId("inbox-row-external");
    expect(external.getAttribute("href")).toBe("https://www.reddit.com/message/messages/remote1");
  });
});
