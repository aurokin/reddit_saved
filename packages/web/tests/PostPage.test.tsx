import "./setup";
import { afterEach, describe, expect, mock, test } from "bun:test";
import { PostPage } from "@/pages/PostPage";
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
import { makePost } from "./fixtures";

const originalFetch = globalThis.fetch;

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
}

function renderPostPage(path = "/post/abc123"): void {
  const queryClient = makeClient();
  const rootRoute = createRootRoute({
    component: () => <Outlet />,
  });
  const browseRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/browse",
    component: () => <div data-testid="browse-page">Browse page</div>,
  });
  const postRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/post/$id",
    component: PostPage,
  });
  const routeTree = rootRoute.addChildren([browseRoute, postRoute]);
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

describe("PostPage unsave handling", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("stays on the post page when Reddit rejects the unsave", async () => {
    const post = makePost({ id: "abc123", title: "Saved post" });
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const rawUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(rawUrl, "http://localhost");

      if (url.pathname === "/api/posts/abc123" && (!init?.method || init.method === "GET")) {
        return Response.json(post);
      }
      if (url.pathname === "/api/unsave" && init?.method === "POST") {
        return Response.json({
          succeeded: [],
          failed: [{ id: "abc123", error: "Stale reddit.com cookies" }],
          cancelled: false,
        });
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${rawUrl}`);
    }) as unknown as typeof fetch;

    renderPostPage();

    await screen.findByText("Saved post");
    fireEvent.click(screen.getByTestId("unsave-button"));
    await screen.findByTestId("confirm-dialog");
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Stale reddit.com cookies");
    });
    expect(screen.queryByTestId("browse-page")).toBeNull();
    expect(screen.getByTestId("post-page")).toBeTruthy();
  });
});
