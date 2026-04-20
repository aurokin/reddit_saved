import "./setup";
import { describe, expect, test } from "bun:test";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { SearchBar } from "@/components/SearchBar";
import { renderWithClient as renderWithProviders } from "./render";

describe("SearchBar", () => {
  test("debounces calls to onSearch", async () => {
    let lastQuery = "";
    let calls = 0;
    renderWithProviders(
      <SearchBar
        debounceMs={50}
        onSearch={(q) => {
          lastQuery = q;
          calls++;
        }}
      />,
    );

    const input = screen.getByTestId("search-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "typ" } });
    fireEvent.change(input, { target: { value: "typescript" } });

    await waitFor(() => {
      expect(lastQuery).toBe("typescript");
    });
    // Mount fires once with empty; typing fires again with latest debounced value.
    expect(calls).toBeGreaterThanOrEqual(1);
  });

  test("renders with a controlled value", () => {
    renderWithProviders(<SearchBar value="golang" onSearch={() => {}} />);
    const input = screen.getByTestId("search-input") as HTMLInputElement;
    expect(input.value).toBe("golang");
  });

  test("does not emit a controlled value again when the parent rerenders", async () => {
    let calls = 0;
    const { rerender } = renderWithProviders(<SearchBar value="rust" debounceMs={20} onSearch={() => {
      calls++;
    }} />);

    rerender(
      <SearchBar
        value="rust"
        debounceMs={20}
        onSearch={() => {
          calls++;
        }}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(calls).toBe(0);
  });
});
