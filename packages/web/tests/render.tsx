import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, type RenderResult } from "@testing-library/react";
import { SyncStreamProvider } from "@/hooks/queries";
import { type ReactElement, type ReactNode, act } from "react";

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
}

/** Plain render for components that don't need a router. */
export function renderWithClient(ui: ReactElement): RenderResult {
  return render(
    <QueryClientProvider client={makeClient()}>
      <SyncStreamProvider>{ui}</SyncStreamProvider>
    </QueryClientProvider>,
  );
}

/** Render inside a memory-history router — needed for <Link> and similar. */
export function renderWithRouter(ui: ReactElement, path = "/"): RenderResult {
  const queryClient = makeClient();
  const rootRoute = createRootRoute({
    component: () => <>{ui}</>,
  });
  const catchAll = createRoute({
    getParentRoute: () => rootRoute,
    path: "$",
    component: () => null,
  });
  const routeTree = rootRoute.addChildren([catchAll]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient },
  });

  let result!: RenderResult;
  act(() => {
    result = render(
      <QueryClientProvider client={queryClient}>
        <SyncStreamProvider>
          <RouterProvider router={router} />
        </SyncStreamProvider>
      </QueryClientProvider>,
    );
  });
  return result;
}

/** Convenience alias kept for existing tests. */
export function renderWithProviders(ui: ReactElement, path = "/"): RenderResult {
  return renderWithRouter(ui, path);
}

export type { ReactNode };
