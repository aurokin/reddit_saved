import "./setup";
import { afterEach, describe, expect, test } from "bun:test";
import { LinksPage } from "@/pages/LinksPage";
import type { LinkSearchRow, TopLink } from "@/types";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./render";

const originalFetch = globalThis.fetch;

const TOP_LINKS: TopLink[] = [
  {
    canonical_url: "github.com/oven-sh/bun",
    host: "github.com",
    postCount: 3,
    occurrenceCount: 4,
    lastSeen: 1_700_000_000,
    sampleUrl: "https://github.com/oven-sh/bun",
  },
  {
    canonical_url: "example.com/article",
    host: "example.com",
    postCount: 1,
    occurrenceCount: 1,
    lastSeen: 1_690_000_000,
    sampleUrl: "https://example.com/article",
  },
];

const SEARCH_ROWS: LinkSearchRow[] = [
  {
    post_id: "abc123",
    source: "url",
    position: 0,
    url: "https://github.com/oven-sh/bun",
    canonical_url: "github.com/oven-sh/bun",
    host: "github.com",
    created_utc: 1_700_000_000,
    title: "Bun repo",
    subreddit: "programming",
    permalink: "/r/programming/comments/abc123/bun/",
  },
];

function mockApi(): { calls: string[] } {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    const respond = (body: unknown): Response =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    if (url.includes("/api/links/search")) {
      return respond({ items: SEARCH_ROWS, query: "x" });
    }
    if (url.includes("/api/links")) {
      return respond({ items: TOP_LINKS });
    }
    return respond({});
  }) as typeof fetch;
  return { calls };
}

describe("LinksPage", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("renders top links with counts", async () => {
    mockApi();
    renderWithProviders(<LinksPage />);

    await waitFor(() => expect(screen.getAllByTestId("link-row")).toHaveLength(2));
    expect(screen.getByText("github.com/oven-sh/bun")).toBeTruthy();
    expect(screen.getByText(/3 posts · 4 occ/)).toBeTruthy();
  });

  test("expanding a row lists referencing posts", async () => {
    mockApi();
    renderWithProviders(<LinksPage />);

    await waitFor(() => expect(screen.getAllByTestId("link-expand").length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByTestId("link-expand")[0] as HTMLElement);

    await waitFor(() => expect(screen.getByText("Bun repo")).toBeTruthy());
    expect(screen.getByText(/r\/programming · url/)).toBeTruthy();
  });

  test("typing a query switches to URL search results", async () => {
    const { calls } = mockApi();
    renderWithProviders(<LinksPage />);

    await waitFor(() => expect(screen.getAllByTestId("link-row")).toHaveLength(2));
    fireEvent.change(screen.getByTestId("links-search"), { target: { value: "bun" } });

    await waitFor(() => expect(screen.getAllByTestId("link-search-row")).toHaveLength(1));
    expect(calls.some((u) => u.includes("/api/links/search") && u.includes("q=bun"))).toBe(true);
  });

  test("exclude-reddit toggle refetches with the flag flipped", async () => {
    const { calls } = mockApi();
    renderWithProviders(<LinksPage />);

    await waitFor(() => expect(screen.getAllByTestId("link-row")).toHaveLength(2));
    expect(calls.some((u) => u.includes("excludeReddit=true"))).toBe(true);

    fireEvent.click(screen.getByTestId("links-exclude-reddit"));
    await waitFor(() => expect(calls.some((u) => u.includes("excludeReddit=false"))).toBe(true));
  });
});
