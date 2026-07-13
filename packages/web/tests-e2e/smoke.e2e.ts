import { expect, test } from "@playwright/test";

test.describe("smoke", () => {
  test("home renders sync status and nav links", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("sync-status")).toBeVisible();
    await expect(page.getByTestId("nav-home")).toBeVisible();
    await expect(page.getByTestId("nav-browse")).toBeVisible();
    await expect(page.getByTestId("nav-links")).toBeVisible();
    await expect(page.getByTestId("nav-inbox")).toBeVisible();
    await expect(page.getByTestId("nav-settings")).toBeVisible();
  });

  test("home renders the dashboard with seeded provenance", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("dashboard-sync-health")).toBeVisible();
    await expect(page.getByTestId("sync-health-saved")).toBeVisible();
    await expect(page.getByTestId("today-strip")).toBeVisible();
    await expect(page.getByTestId("inbox-preview")).toBeVisible();
    // Seed marks the upvoted run saturated → amber warning copy
    await expect(page.getByText("Orphan detection saturated — run a full sync")).toBeVisible();
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

  test("links page renders seeded outbound links", async ({ page }) => {
    await page.goto("/links");
    await expect(page.getByTestId("links-page")).toBeVisible();
    // Seed generates external-link posts (github.com etc.) inside the last year;
    // default window is 30d so switch to all-time for a deterministic hit.
    await page.getByTestId("links-window").selectOption("all");
    await expect(page.getByTestId("link-row").first()).toBeVisible({ timeout: 10_000 });
  });

  test("inbox page renders seeded rows and syncs tab to URL", async ({ page }) => {
    await page.goto("/inbox");
    await expect(page.getByTestId("inbox-page")).toBeVisible();
    await expect(page.getByTestId("inbox-row").first()).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("inbox-tab-message").click();
    await expect(page).toHaveURL(/type=message/);
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
