import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.WEB_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests-e2e",
  testMatch: /.*\.e2e\.ts$/,
  timeout: 30_000,
  retries: 0,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: process.env.WEB_BASE_URL
    ? undefined
    : {
        // Seed the package-local fixture DB, then boot Vite (3000) + API (3001).
        command: "bun run seed && TEST_MODE=1 bun run dev",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 60_000,
      },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
