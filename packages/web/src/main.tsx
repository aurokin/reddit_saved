import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { router } from "./router";
import "./styles/globals.css";
import { queryClient } from "./lib/query-client";
import { SyncStreamProvider } from "./hooks/queries";

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root missing");

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SyncStreamProvider>
        <RouterProvider router={router} />
      </SyncStreamProvider>
    </QueryClientProvider>
  </StrictMode>,
);
