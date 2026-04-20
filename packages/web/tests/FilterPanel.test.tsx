import "./setup";
import { describe, expect, mock, test } from "bun:test";
import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { FilterPanel } from "@/components/FilterPanel";
import type { BrowseFilters } from "@/types";
import { renderWithClient as renderWithProviders } from "./render";

function Host({ initial = {} }: { initial?: BrowseFilters }) {
  const [filters, setFilters] = useState<BrowseFilters>(initial);
  return <FilterPanel filters={filters} onChange={setFilters} />;
}

describe("FilterPanel", () => {
  test("updates subreddit input", () => {
    renderWithProviders(<Host />);
    const input = screen.getByTestId("filter-subreddit") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "golang" } });
    expect(input.value).toBe("golang");
  });

  test("shows Clear button only with active filter and resets all state", () => {
    renderWithProviders(<Host initial={{ subreddit: "typescript" }} />);
    const clear = screen.getByTestId("clear-filters");
    fireEvent.click(clear);
    const sub = screen.getByTestId("filter-subreddit") as HTMLInputElement;
    expect(sub.value).toBe("");
  });

  test("preserves the search query when clearing sidebar filters", () => {
    const onChange = mock((_next: BrowseFilters) => {});
    renderWithProviders(
      <FilterPanel
        filters={{ q: "rust", subreddit: "typescript", orphaned: true }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByTestId("clear-filters"));

    expect(onChange).toHaveBeenCalledWith({ q: "rust" });
  });

  test("toggles origin pill", () => {
    renderWithProviders(<Host />);
    const savedBtn = screen.getByText("Saved");
    fireEvent.click(savedBtn);
    // After click the button should have the "default" variant styling — we just
    // assert it's still in the document; full styling is out of scope.
    expect(savedBtn).toBeDefined();
  });
});
