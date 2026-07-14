import "./setup";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { HealthBanner } from "@/components/HealthBanner";
import type { JobRunSummary } from "@/types";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./render";

const originalFetch = globalThis.fetch;

function makeJobRun(overrides: Partial<JobRunSummary> = {}): JobRunSummary {
  return {
    id: 1,
    startedAt: Date.now() - 3_600_000,
    finishedAt: Date.now() - 3_540_000,
    status: "complete",
    trigger: "launchd",
    steps: [
      { step: "fetch", ok: true, durationMs: 1000 },
      { step: "inbox", ok: true, durationMs: 200 },
    ],
    ...overrides,
  };
}

function mockApi(payloads: {
  authenticated?: boolean;
  blocked?: boolean;
  totalPosts?: number;
  jobRuns?: JobRunSummary[];
}): { calls: string[] } {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    const respond = (body: unknown): Response =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    if (url.includes("/api/auth/status")) {
      return respond({
        authenticated: payloads.authenticated ?? true,
        username: payloads.authenticated === false ? null : "tester",
        testMode: false,
      });
    }
    if (url.includes("/api/auth/session")) {
      return respond({ connected: !payloads.blocked, blocked: payloads.blocked ?? false });
    }
    if (url.includes("/api/jobs")) {
      return respond({ items: payloads.jobRuns ?? [makeJobRun()] });
    }
    if (url.includes("/api/sync/status")) {
      return respond({
        isRunning: false,
        lastSyncTime: null,
        lastFullSyncTime: null,
        incrementalCursors: {},
        stats: {
          totalPosts: payloads.totalPosts ?? 10,
          totalComments: 0,
          orphanedCount: 0,
          activeCountByOrigin: { saved: 10, upvoted: 0, submitted: 0, commented: 0 },
          contextCount: 0,
          subredditCounts: [],
          tagCounts: [],
          oldestItem: null,
          newestItem: null,
          lastSyncTime: null,
        },
      });
    }
    return respond({});
  }) as typeof fetch;
  return { calls };
}

/** Wait until every hook the banner reads has fetched at least once. */
async function waitForQueries(calls: string[]): Promise<void> {
  await waitFor(() => {
    for (const path of ["/api/auth/status", "/api/auth/session", "/api/jobs", "/api/sync/status"]) {
      expect(calls.some((u) => u.includes(path))).toBe(true);
    }
  });
}

describe("HealthBanner", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    sessionStorage.clear();
  });

  test("renders nothing when everything is healthy", async () => {
    const { calls } = mockApi({});
    renderWithProviders(<HealthBanner />);

    await waitForQueries(calls);
    expect(screen.queryByTestId("health-banner")).toBeNull();
  });

  test("shows the paused warning when the session is deliberately blocked", async () => {
    mockApi({ blocked: true });
    renderWithProviders(<HealthBanner />);

    await waitFor(() => expect(screen.getByTestId("health-banner")).toBeTruthy());
    expect(screen.getByTestId("health-banner").textContent).toContain("scheduled syncs are paused");
    // Blocked rejects forwarded sessions, so the copy must not suggest
    // browsing reddit.com — Reconnect is the only way out.
    expect(screen.getByTestId("health-banner").textContent).not.toContain("reddit.com");
    expect(screen.getByText("Reconnect")).toBeTruthy();
  });

  test("shows the expired warning when unauthenticated with data in the archive", async () => {
    mockApi({ authenticated: false, totalPosts: 10 });
    renderWithProviders(<HealthBanner />);

    await waitFor(() => expect(screen.getByTestId("health-banner")).toBeTruthy());
    const text = screen.getByTestId("health-banner").textContent ?? "";
    expect(text).toContain("scheduled syncs are failing");
    expect(text).toContain("Browse reddit.com");
  });

  test("stays hidden when unauthenticated but the archive is empty", async () => {
    const { calls } = mockApi({ authenticated: false, totalPosts: 0 });
    renderWithProviders(<HealthBanner />);

    await waitForQueries(calls);
    expect(screen.queryByTestId("health-banner")).toBeNull();
  });

  test("shows the failed-run warning with failed step names", async () => {
    mockApi({
      jobRuns: [
        makeJobRun({
          id: 7,
          status: "errored",
          steps: [
            { step: "fetch", ok: false, durationMs: 100, error: "session expired" },
            { step: "inbox", ok: true, durationMs: 50 },
          ],
        }),
      ],
    });
    renderWithProviders(<HealthBanner />);

    await waitFor(() => expect(screen.getByTestId("health-banner")).toBeTruthy());
    const text = screen.getByTestId("health-banner").textContent ?? "";
    // Step ids are mapped to human labels, never shown raw.
    expect(text).toContain("failed steps: fetching posts");
    expect(text).toContain("Your archive is safe");
    // A non-session failure must not blame the session.
    expect(text).not.toContain("session is restored");
    expect(screen.getByText("Scheduled jobs")).toBeTruthy();
  });

  test("session problems outrank an errored run", async () => {
    mockApi({
      blocked: true,
      jobRuns: [makeJobRun({ id: 7, status: "errored" })],
    });
    renderWithProviders(<HealthBanner />);

    await waitFor(() => expect(screen.getByTestId("health-banner")).toBeTruthy());
    expect(screen.getByTestId("health-banner").textContent).toContain("scheduled syncs are paused");
  });

  test("dismiss hides the banner for the same failure but a new failure reappears", async () => {
    mockApi({ jobRuns: [makeJobRun({ id: 7, status: "errored" })] });
    const first = renderWithProviders(<HealthBanner />);

    await waitFor(() => expect(screen.getByTestId("health-banner")).toBeTruthy());
    fireEvent.click(screen.getByTestId("health-banner-dismiss"));
    expect(screen.queryByTestId("health-banner")).toBeNull();
    first.unmount();

    // Same failing run id → stays dismissed for this browser session.
    const { calls } = mockApi({ jobRuns: [makeJobRun({ id: 7, status: "errored" })] });
    const second = renderWithProviders(<HealthBanner />);
    await waitForQueries(calls);
    expect(screen.queryByTestId("health-banner")).toBeNull();
    second.unmount();

    // A NEW failing run id → the banner reappears.
    mockApi({ jobRuns: [makeJobRun({ id: 8, status: "errored" })] });
    renderWithProviders(<HealthBanner />);
    await waitFor(() => expect(screen.getByTestId("health-banner")).toBeTruthy());
  });
});
