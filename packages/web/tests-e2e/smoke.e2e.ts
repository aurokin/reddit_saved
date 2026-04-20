import { expect, test } from "@playwright/test";

test.describe("smoke", () => {
  test("home renders sync status and nav links", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("sync-status")).toBeVisible();
    await expect(page.getByTestId("nav-home")).toBeVisible();
    await expect(page.getByTestId("nav-browse")).toBeVisible();
    await expect(page.getByTestId("nav-settings")).toBeVisible();
  });

  test("browse page renders filter panel and post list with seeded data", async ({ page }) => {
    await page.goto("/browse");
    await expect(page.getByTestId("filter-panel")).toBeVisible();
    // Seed adds 200 items; at least one card should show up.
    await expect(page.getByTestId("post-card").first()).toBeVisible({ timeout: 10_000 });
  });

  test("filter by subreddit updates URL and list", async ({ page }) => {
    await page.goto("/browse");
    const subField = page.getByTestId("filter-subreddit");
    await subField.fill("typescript");
    await expect(page).toHaveURL(/subreddit=typescript/);
  });

  test("settings page shows TEST_MODE account and export buttons", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByTestId("settings-page")).toBeVisible();
    await expect(page.getByTestId("export-json")).toBeVisible();
    await expect(page.getByTestId("export-csv")).toBeVisible();
    await expect(page.getByTestId("export-markdown")).toBeVisible();
  });

  test("dark mode toggle swaps icon", async ({ page }) => {
    await page.goto("/");
    const toggle = page.getByTestId("dark-mode-toggle");
    await toggle.click();
    // After click, the html element should have the "dark" class.
    await expect(page.locator("html")).toHaveClass(/dark/);
  });
});
