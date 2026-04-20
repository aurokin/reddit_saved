import "./setup";
import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  useAddPostTag,
  useDeleteTag,
  usePost,
  usePosts,
  useRemovePostTag,
  useRenameTag,
  useSearchPosts,
  useTags,
} from "@/hooks/queries";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { useEffect } from "react";

const originalFetch = globalThis.fetch;

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
}

function AddTagHarness() {
  const list = usePosts({ limit: 50 });
  const search = useSearchPosts({ limit: 50, q: "rust" });
  const { mutateAsync, status } = useAddPostTag("post1");

  useEffect(() => {
    if (list.isSuccess && search.isSuccess && status === "idle") {
      void mutateAsync("favorite");
    }
  }, [list.isSuccess, mutateAsync, search.isSuccess, status]);

  return null;
}

function RemoveTagHarness() {
  const list = usePosts({ limit: 50 });
  const search = useSearchPosts({ limit: 50, q: "rust" });
  const { mutateAsync, status } = useRemovePostTag("post1");

  useEffect(() => {
    if (list.isSuccess && search.isSuccess && status === "idle") {
      void mutateAsync("favorite");
    }
  }, [list.isSuccess, mutateAsync, search.isSuccess, status]);

  return null;
}

function RenameTagHarness() {
  const tags = useTags();
  const list = usePosts({ limit: 50 });
  const search = useSearchPosts({ limit: 50, q: "rust" });
  const post = usePost("post1");
  const { mutateAsync, status } = useRenameTag();

  useEffect(() => {
    if (tags.isSuccess && list.isSuccess && search.isSuccess && post.isSuccess && status === "idle") {
      void mutateAsync({ oldName: "favorite", newName: "favorites" });
    }
  }, [list.isSuccess, mutateAsync, post.isSuccess, search.isSuccess, status, tags.isSuccess]);

  return null;
}

function DeleteTagHarness() {
  const tags = useTags();
  const list = usePosts({ limit: 50 });
  const search = useSearchPosts({ limit: 50, q: "rust" });
  const post = usePost("post1");
  const { mutateAsync, status } = useDeleteTag();

  useEffect(() => {
    if (tags.isSuccess && list.isSuccess && search.isSuccess && post.isSuccess && status === "idle") {
      void mutateAsync("favorite");
    }
  }, [list.isSuccess, mutateAsync, post.isSuccess, search.isSuccess, status, tags.isSuccess]);

  return null;
}

describe("tag mutation cache invalidation", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("adding a tag refetches active list and search queries", async () => {
    let listCalls = 0;
    let searchCalls = 0;
    let addCalls = 0;

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith("/api/posts/search")) {
        searchCalls++;
        return Response.json({ items: [], total: 0, query: "rust", limit: 50, offset: 0 });
      }
      if (url.startsWith("/api/posts?")) {
        listCalls++;
        return Response.json({ items: [], total: 0, limit: 50, offset: 0 });
      }
      if (url === "/api/posts/post1/tags" && init?.method === "POST") {
        addCalls++;
        return Response.json({ ok: true });
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    }) as unknown as typeof fetch;

    render(
      <QueryClientProvider client={makeClient()}>
        <AddTagHarness />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(addCalls).toBe(1));
    await waitFor(() => expect(listCalls).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(searchCalls).toBeGreaterThanOrEqual(2));
  });

  test("removing a tag refetches active list and search queries", async () => {
    let listCalls = 0;
    let searchCalls = 0;
    let removeCalls = 0;

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith("/api/posts/search")) {
        searchCalls++;
        return Response.json({ items: [], total: 0, query: "rust", limit: 50, offset: 0 });
      }
      if (url.startsWith("/api/posts?")) {
        listCalls++;
        return Response.json({ items: [], total: 0, limit: 50, offset: 0 });
      }
      if (url === "/api/posts/post1/tags/favorite" && init?.method === "DELETE") {
        removeCalls++;
        return Response.json({ ok: true });
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    }) as unknown as typeof fetch;

    render(
      <QueryClientProvider client={makeClient()}>
        <RemoveTagHarness />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(removeCalls).toBe(1));
    await waitFor(() => expect(listCalls).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(searchCalls).toBeGreaterThanOrEqual(2));
  });

  test("renaming a tag refetches tag, list, search, and post detail queries", async () => {
    let tagsCalls = 0;
    let listCalls = 0;
    let searchCalls = 0;
    let postCalls = 0;
    let renameCalls = 0;

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "/api/tags") {
        tagsCalls++;
        return Response.json({ items: [{ id: "tag-1", name: "favorite", count: 1 }] });
      }
      if (url.startsWith("/api/posts/search")) {
        searchCalls++;
        return Response.json({ items: [], total: 0, query: "rust", limit: 50, offset: 0 });
      }
      if (url.startsWith("/api/posts?")) {
        listCalls++;
        return Response.json({ items: [], total: 0, limit: 50, offset: 0 });
      }
      if (url === "/api/posts/post1") {
        postCalls++;
        return Response.json({ id: "post1", title: "Saved post", tags: ["favorite"] });
      }
      if (url === "/api/tags/favorite" && init?.method === "PATCH") {
        renameCalls++;
        return Response.json({ ok: true });
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    }) as unknown as typeof fetch;

    render(
      <QueryClientProvider client={makeClient()}>
        <RenameTagHarness />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(renameCalls).toBe(1));
    await waitFor(() => expect(tagsCalls).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(listCalls).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(searchCalls).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(postCalls).toBeGreaterThanOrEqual(2));
  });

  test("deleting a tag refetches tag, list, search, and post detail queries", async () => {
    let tagsCalls = 0;
    let listCalls = 0;
    let searchCalls = 0;
    let postCalls = 0;
    let deleteCalls = 0;

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "/api/tags") {
        tagsCalls++;
        return Response.json({ items: [{ id: "tag-1", name: "favorite", count: 1 }] });
      }
      if (url.startsWith("/api/posts/search")) {
        searchCalls++;
        return Response.json({ items: [], total: 0, query: "rust", limit: 50, offset: 0 });
      }
      if (url.startsWith("/api/posts?")) {
        listCalls++;
        return Response.json({ items: [], total: 0, limit: 50, offset: 0 });
      }
      if (url === "/api/posts/post1") {
        postCalls++;
        return Response.json({ id: "post1", title: "Saved post", tags: ["favorite"] });
      }
      if (url === "/api/tags/favorite" && init?.method === "DELETE") {
        deleteCalls++;
        return Response.json({ ok: true });
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    }) as unknown as typeof fetch;

    render(
      <QueryClientProvider client={makeClient()}>
        <DeleteTagHarness />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(deleteCalls).toBe(1));
    await waitFor(() => expect(tagsCalls).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(listCalls).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(searchCalls).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(postCalls).toBeGreaterThanOrEqual(2));
  });
});
