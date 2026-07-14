import "./setup";
import { afterEach, describe, expect, test } from "bun:test";
import { OnboardingChecklist } from "@/components/OnboardingChecklist";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./render";

const originalFetch = globalThis.fetch;
const originalEventSource = globalThis.EventSource;

class MockEventSource {
  static latest: MockEventSource | null = null;
  constructor(public readonly url: string | URL) {
    MockEventSource.latest = this;
  }
  addEventListener(): void {}
  close(): void {}
}

function mockApi(payloads: {
  authenticated?: boolean;
  totalPosts?: number;
  jobRunCount?: number;
}): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const respond = (body: unknown): Response =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    if (url.includes("/api/auth/status")) {
      return respond({
        authenticated: payloads.authenticated ?? false,
        username: payloads.authenticated ? "tester" : null,
        testMode: false,
      });
    }
    if (url.includes("/api/jobs")) {
      return respond({
        items: Array.from({ length: payloads.jobRunCount ?? 0 }, (_, i) => ({
          id: i + 1,
          startedAt: 1_800_000_000_000,
          finishedAt: 1_800_000_060_000,
          status: "complete",
          trigger: "manual",
          steps: [],
        })),
      });
    }
    if (url.includes("/api/sync/status")) {
      return respond({
        isRunning: false,
        lastSyncTime: null,
        lastFullSyncTime: null,
        incrementalCursors: {},
        stats: {
          totalPosts: payloads.totalPosts ?? 0,
          totalComments: 0,
          orphanedCount: 0,
          activeCountByOrigin: { saved: 0, upvoted: 0, submitted: 0, commented: 0 },
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
}

function stepDone(testId: string): boolean {
  return screen.getByTestId(testId).getAttribute("data-done") === "true";
}

describe("OnboardingChecklist", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.EventSource = originalEventSource;
    MockEventSource.latest = null;
  });

  test("all steps pending on a fresh install", async () => {
    mockApi({});
    renderWithProviders(<OnboardingChecklist />);

    await waitFor(() => expect(screen.getByTestId("onboarding")).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId("onboarding-login")).toBeTruthy());
    expect(stepDone("onboarding-step-connect")).toBe(false);
    expect(stepDone("onboarding-step-sync")).toBe(false);
    expect(stepDone("onboarding-step-schedule")).toBe(false);
    // The sync button is useless before Connect, so it starts disabled.
    expect((screen.getByTestId("onboarding-sync") as HTMLButtonElement).disabled).toBe(true);
    // Scheduling hints show both platform commands
    expect(screen.getByText("reddit-cached jobs install-launchd")).toBeTruthy();
    expect(screen.getByText("reddit-cached jobs install-systemd")).toBeTruthy();
  });

  test("derives each done state live from the queries", async () => {
    mockApi({ authenticated: true, totalPosts: 4, jobRunCount: 1 });
    renderWithProviders(<OnboardingChecklist />);

    await waitFor(() => expect(stepDone("onboarding-step-connect")).toBe(true));
    await waitFor(() => expect(stepDone("onboarding-step-sync")).toBe(true));
    await waitFor(() => expect(stepDone("onboarding-step-schedule")).toBe(true));
    // Backup has no web-side detection — shown as a plain hint, never a
    // checkbox step that could read as not-done.
    expect(screen.getByTestId("onboarding-step-backup").getAttribute("data-done")).toBeNull();
    expect(screen.queryByTestId("onboarding-login")).toBeNull();
  });

  test("first-sync button starts a full saved sync", async () => {
    mockApi({ authenticated: true });
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
    renderWithProviders(<OnboardingChecklist />);

    await waitFor(() => expect(screen.getByTestId("onboarding-sync")).toBeTruthy());
    fireEvent.click(screen.getByTestId("onboarding-sync"));
    await waitFor(() => expect(MockEventSource.latest).not.toBeNull());
    expect(String(MockEventSource.latest?.url)).toContain("type=saved");
    expect(String(MockEventSource.latest?.url)).toContain("full=true");
  });
});
