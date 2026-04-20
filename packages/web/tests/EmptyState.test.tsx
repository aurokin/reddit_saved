import "./setup";
import { describe, expect, test } from "bun:test";
import { screen } from "@testing-library/react";
import { EmptyState } from "@/components/EmptyState";
import { renderWithClient as renderWithProviders } from "./render";

describe("EmptyState", () => {
  test("uses default title when none passed", () => {
    renderWithProviders(<EmptyState />);
    expect(screen.getByText(/nothing here yet/i)).toBeDefined();
  });

  test("renders custom title and action", () => {
    renderWithProviders(
      <EmptyState
        title="No posts"
        description="Try syncing"
        action={<button type="button">Sync</button>}
      />,
    );
    expect(screen.getByText("No posts")).toBeDefined();
    expect(screen.getByText("Try syncing")).toBeDefined();
    expect(screen.getByRole("button", { name: "Sync" })).toBeDefined();
  });
});
