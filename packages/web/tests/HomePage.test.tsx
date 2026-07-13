import "./setup";
import { afterEach, describe, expect, test } from "bun:test";
import { SyncHealthCard } from "@/components/dashboard/SyncHealthCard";
import { HomePage } from "@/pages/HomePage";
import type { SyncRunSummary, TodayDigest } from "@/types";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "./render";

const originalFetch = globalThis.fetch;
const originalEventSource = globalThis.EventSource;

function makeDigest(overrides: Partial<TodayDigest> = {}): TodayDigest {
  return {
    generatedAt: 1_800_000_000_000,
    windowStart: 1_799_913_600_000,
    windowMs: 86_400_000,
    syncHealth: [],
    newByOrigin: [
      { origin: "saved", count: 2, top: [] },
      { origin: "upvoted", count: 0, top: [] },
      { origin: "submitted", count: 0, top: [] },
      { origin: "commented", count: 0, top: [] },
    ],
    inbox: { newCount: 1, unreadCount: 3, items: [] },
    topLinks: [],
    context: { captured: 10, backlog: 5 },
    jobs: { lastRun: null },
    ...overrides,
  };
}

function makeRun(
  origin: SyncRunSummary["origin"],
  overrides: Partial<NonNullable<SyncRunSummary["lastRun"]>> = {},
  lastCompleteFullAt: number | null = 1_800_000_000_000,
): SyncRunSummary {
  return {
    origin,
    lastRun: {
      mode: "incremental",
      startedAt: 1_800_000_000_000,
      finishedAt: 1_800_000_060_000,
      fetched: 12,
      orphaned: null,
      saturated: false,
      status: "complete",
      ...overrides,
    },
    lastCompleteFullAt,
  };
}

function mockApi(payloads: {
  runs?: SyncRunSummary[];
  digest?: TodayDigest;
  markdown?: string;
}): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const respond = (body: unknown): Response =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    if (url.includes("/api/auth/status")) {
      return respond({ authenticated: true, username: "tester", testMode: true });
    }
    if (url.includes("/api/sync/runs")) {
      return respond({ items: payloads.runs ?? [] });
    }
    if (url.includes("/api/sync/status")) {
      return respond({
        isRunning: false,
        lastSyncTime: null,
        lastFullSyncTime: null,
        incrementalCursors: {},
        stats: {
          totalPosts: 0,
          totalComments: 0,
          orphanedCount: 0,
          activeCountByOrigin: { saved: 5, upvoted: 2, submitted: 1, commented: 3 },
          contextCount: 10,
          subredditCounts: [],
          tagCounts: [],
          oldestItem: null,
          newestItem: null,
          lastSyncTime: null,
        },
      });
    }
    if (url.includes("/api/today")) {
      return respond({
        digest: payloads.digest ?? makeDigest(),
        markdown: payloads.markdown ?? "# Today: last 24h",
      });
    }
    if (url.includes("/api/links")) {
      return respond({ items: [] });
    }
    if (url.includes("/api/tags")) {
      return respond({ items: [] });
    }
    if (url.includes("/api/posts")) {
      return respond({ items: [], total: 0, limit: 12, offset: 0 });
    }
    return respond({});
  }) as typeof fetch;
}

class MockEventSource {
  static latest: MockEventSource | null = null;
  constructor(public readonly url: string | URL) {
    MockEventSource.latest = this;
  }
  addEventListener(): void {}
  close(): void {}
}

describe("HomePage dashboard", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.EventSource = originalEventSource;
    MockEventSource.latest = null;
  });

  test("renders empty state when the archive has nothing new", async () => {
    mockApi({
      digest: makeDigest({
        newByOrigin: [
          { origin: "saved", count: 0, top: [] },
          { origin: "upvoted", count: 0, top: [] },
          { origin: "submitted", count: 0, top: [] },
          { origin: "commented", count: 0, top: [] },
        ],
        inbox: { newCount: 0, unreadCount: 0, items: [] },
      }),
    });
    renderWithProviders(<HomePage />);

    await waitFor(() => expect(screen.getByTestId("dashboard-sync-health")).toBeTruthy());
    await waitFor(() =>
      expect(screen.getByText("Nothing new reached the archive in the last 24h.")).toBeTruthy(),
    );
    expect(screen.getByText("No new replies, mentions, or messages.")).toBeTruthy();
    expect(screen.getByText("No saved posts yet")).toBeTruthy();
    // Never-synced origins show a "never" badge (scoped — SyncStatus also says "never")
    const healthGrid = within(screen.getByTestId("dashboard-sync-health"));
    expect(healthGrid.getAllByText("never")).toHaveLength(4);
  });

  test("shows saturation warning and errored badge from sync runs", async () => {
    mockApi({
      runs: [
        makeRun("saved", { saturated: true }),
        makeRun("upvoted", { status: "errored" }),
        makeRun("submitted"),
        makeRun("commented"),
      ],
    });
    renderWithProviders(<HomePage />);

    await waitFor(() =>
      expect(screen.getByText("Orphan detection saturated — run a full sync")).toBeTruthy(),
    );
    expect(screen.getByText("errored")).toBeTruthy();
    expect(screen.getAllByText("complete").length).toBeGreaterThanOrEqual(2);
  });

  test("warns when an origin has never had a complete full sync", async () => {
    mockApi({ runs: [makeRun("saved", {}, null)] });
    renderWithProviders(<HomePage />);

    await waitFor(() => expect(screen.getByText("No complete full sync yet")).toBeTruthy());
  });

  test("today strip shows per-origin and inbox counts", async () => {
    mockApi({});
    renderWithProviders(<HomePage />);

    await waitFor(() => expect(screen.getByTestId("today-strip")).toBeTruthy());
    const strip = screen.getByTestId("today-strip");
    expect(strip.textContent).toContain("Saved 2");
    expect(strip.textContent).toContain("Inbox 1");
    expect(screen.getByTestId("inbox-unread-badge").textContent).toBe("3 unread");
  });
});

describe("SyncHealthCard", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.EventSource = originalEventSource;
    MockEventSource.latest = null;
  });

  test("start button opens a sync stream for its own origin", async () => {
    mockApi({});
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
    renderWithProviders(
      <SyncHealthCard origin="upvoted" summary={makeRun("upvoted")} activeCount={2} />,
    );

    await waitFor(() => expect(screen.getByTestId("sync-start-upvoted")).toBeTruthy());
    fireEvent.click(screen.getByTestId("sync-start-upvoted"));
    await waitFor(() => expect(MockEventSource.latest).not.toBeNull());
    expect(String(MockEventSource.latest?.url)).toContain("type=upvoted");
    expect(String(MockEventSource.latest?.url)).toContain("full=false");
  });
});
