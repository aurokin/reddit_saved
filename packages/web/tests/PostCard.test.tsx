import "./setup";
import { describe, expect, mock, test } from "bun:test";
import { screen } from "@testing-library/react";
import {
  SEARCH_SNIPPET_HIGHLIGHT_END,
  SEARCH_SNIPPET_HIGHLIGHT_START,
} from "@reddit-saved/core/search-snippet";

// Stub @tanstack/react-router Link to a plain anchor so PostCard doesn't
// need a full RouterProvider just to render.
mock.module("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: { children: React.ReactNode; to?: string; [k: string]: unknown }) => (
    <a href={typeof to === "string" ? to : "#"} {...(props as object)}>
      {children}
    </a>
  ),
}));

import { PostCard } from "@/components/PostCard";
import { makePost } from "./fixtures";
import { renderWithClient } from "./render";

describe("PostCard", () => {
  test("renders the title and subreddit", () => {
    renderWithClient(<PostCard post={makePost({ title: "Hello world" })} />);
    expect(screen.getByText("Hello world")).toBeDefined();
    expect(screen.getByText(/typescript/)).toBeDefined();
  });

  test("shows orphaned badge when is_on_reddit is 0", () => {
    renderWithClient(<PostCard post={makePost({ is_on_reddit: 0 })} />);
    expect(screen.getByText(/orphaned/i)).toBeDefined();
  });

  test("shows comment badge for t1 kind and falls back to link_title", () => {
    renderWithClient(
      <PostCard
        post={makePost({
          kind: "t1",
          title: null,
          link_title: "Parent post title",
          body: "comment body",
        })}
      />,
    );
    expect(screen.getByText("Parent post title")).toBeDefined();
    expect(screen.getByText("Comment")).toBeDefined();
  });

  test("renders snippet highlights and escapes attacker-controlled markup", () => {
    renderWithClient(
      <PostCard
        post={makePost()}
        snippet={[
          "hello ",
          SEARCH_SNIPPET_HIGHLIGHT_START,
          "world",
          SEARCH_SNIPPET_HIGHLIGHT_END,
          ' <b onmouseover="bad()">trap</b> <img src=x onerror="bad()">',
        ].join("")}
      />,
    );
    const snippet = document.querySelector(".fts-snippet");
    expect(snippet).not.toBeNull();
    const highlighted = snippet?.querySelectorAll("b") ?? [];
    expect(highlighted.length).toBe(1);
    expect(highlighted[0]?.textContent).toBe("world");
    expect(highlighted[0]?.attributes.length).toBe(0);
    expect(snippet?.querySelector("img")).toBeNull();
    expect(snippet?.innerHTML.includes("&lt;b onmouseover=")).toBe(true);
  });
});
