import { afterEach, describe, expect, test } from "bun:test";
import { PerformanceMonitor, formatBytes, formatDuration } from "../src/monitor/performance";

describe("PerformanceMonitor", () => {
  let monitor: PerformanceMonitor;

  afterEach(() => {
    monitor?.reset();
  });

  test("startSession resets metrics and sets startTime", () => {
    monitor = new PerformanceMonitor();
    monitor.startSession();
    const metrics = monitor.getSyncMetrics();
    expect(metrics.startTime).toBeGreaterThan(0);
    expect(metrics.itemsFetched).toBe(0);
    expect(metrics.itemsProcessed).toBe(0);
  });

  test("endSession sets endTime", () => {
    monitor = new PerformanceMonitor();
    monitor.startSession();
    monitor.endSession();
    const metrics = monitor.getSyncMetrics();
    expect(metrics.endTime).toBeDefined();
    expect(metrics.endTime as number).toBeGreaterThanOrEqual(metrics.startTime);
  });

  test("recordRequest updates counts and response times", () => {
    monitor = new PerformanceMonitor();
    monitor.startSession();

    monitor.recordRequest(true, 100, 1024);
    monitor.recordRequest(true, 200, 2048);
    monitor.recordRequest(false, 500, 0, true);

    const req = monitor.getRequestMetrics();
    expect(req.totalRequests).toBe(3);
    expect(req.successfulRequests).toBe(2);
    expect(req.failedRequests).toBe(1);
    expect(req.rateLimitedRequests).toBe(1);
    expect(req.totalBytesDownloaded).toBe(3072);
    expect(req.minResponseTimeMs).toBe(100);
    expect(req.maxResponseTimeMs).toBe(500);
    expect(req.avgResponseTimeMs).toBeCloseTo(266.67, 0);
  });

  test("does not record when not monitoring", () => {
    monitor = new PerformanceMonitor();
    // Do NOT call startSession
    monitor.recordRequest(true, 100);
    monitor.recordItemsFetched(10);
    monitor.recordItemProcessed("stored");

    expect(monitor.getRequestMetrics().totalRequests).toBe(0);
    expect(monitor.getSyncMetrics().itemsFetched).toBe(0);
  });

  test("recordMemorySample works even when not monitoring", () => {
    monitor = new PerformanceMonitor();
    // Do NOT call startSession — recordMemorySample has no isMonitoring guard
    monitor.recordMemorySample({ timestamp: Date.now(), rssBytes: 1024 });
    const metrics = monitor.getSyncMetrics();
    expect(metrics.memoryUsageSamples.length).toBe(1);
    expect(metrics.memoryUsageSamples[0].rssBytes).toBe(1024);
  });

  test("recordRateLimitWait accumulates wait time", () => {
    monitor = new PerformanceMonitor();
    monitor.startSession();

    monitor.recordRateLimitWait(1000);
    monitor.recordRateLimitWait(2000);

    expect(monitor.getRequestMetrics().rateLimitWaitTimeMs).toBe(3000);
  });

  test("recordItemsFetched increments count", () => {
    monitor = new PerformanceMonitor();
    monitor.startSession();

    monitor.recordItemsFetched(10);
    monitor.recordItemsFetched(5);

    expect(monitor.getSyncMetrics().itemsFetched).toBe(15);
  });

  test("recordItemProcessed routes correctly", () => {
    monitor = new PerformanceMonitor();
    monitor.startSession();

    monitor.recordItemProcessed("stored");
    monitor.recordItemProcessed("stored");
    monitor.recordItemProcessed("skipped");
    monitor.recordItemProcessed("failed");

    const m = monitor.getSyncMetrics();
    expect(m.itemsProcessed).toBe(4);
    expect(m.itemsStored).toBe(2);
    expect(m.itemsSkipped).toBe(1);
    expect(m.itemsFailed).toBe(1);
  });

  test("getSummary computes correct rates", () => {
    monitor = new PerformanceMonitor();
    monitor.startSession();

    // Simulate some work
    monitor.recordRequest(true, 100);
    monitor.recordRequest(true, 100);
    monitor.recordRequest(false, 100, 0, true);
    monitor.recordItemProcessed("stored");
    monitor.recordItemProcessed("stored");

    monitor.endSession();

    const summary = monitor.getSummary();
    // durationMs may be 0 if start and end are in the same ms tick
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
    expect(summary.requestSuccessRate).toBeCloseTo(0.667, 1);
    expect(summary.rateLimitPercentage).toBeCloseTo(0.333, 1);
    expect(typeof summary.itemsPerSecond).toBe("number");
  });

  test("itemsPerSecond is 0 when no items processed", () => {
    monitor = new PerformanceMonitor();
    monitor.startSession();
    monitor.endSession();

    const summary = monitor.getSummary();
    expect(summary.itemsPerSecond).toBe(0);
  });

  test("getCurrentRequestRate returns 0 with < 2 timestamps", () => {
    monitor = new PerformanceMonitor();
    monitor.startSession();
    expect(monitor.getCurrentRequestRate()).toBe(0);

    monitor.recordRequest(true, 100);
    expect(monitor.getCurrentRequestRate()).toBe(0);
  });

  describe("identifyBottlenecks", () => {
    test("detects high rate limit percentage", () => {
      monitor = new PerformanceMonitor();
      monitor.startSession();

      // 4 out of 10 rate limited = 40%
      for (let i = 0; i < 6; i++) monitor.recordRequest(true, 100);
      for (let i = 0; i < 4; i++) monitor.recordRequest(false, 100, 0, true);

      const bottlenecks = monitor.identifyBottlenecks();
      const rl = bottlenecks.find((b) => b.type === "rate_limit");
      expect(rl).toBeDefined();
      expect(rl?.severity).toBe("high");
    });

    test("detects low success rate", () => {
      monitor = new PerformanceMonitor();
      monitor.startSession();

      // 3 out of 10 failed = 70% success
      for (let i = 0; i < 7; i++) monitor.recordRequest(true, 100);
      for (let i = 0; i < 3; i++) monitor.recordRequest(false, 100);

      const bottlenecks = monitor.identifyBottlenecks();
      const net = bottlenecks.find((b) => b.type === "network" && b.description.includes("failed"));
      expect(net).toBeDefined();
    });

    test("detects high latency", () => {
      monitor = new PerformanceMonitor();
      monitor.startSession();

      monitor.recordRequest(true, 6000);

      const bottlenecks = monitor.identifyBottlenecks();
      const net = bottlenecks.find(
        (b) => b.type === "network" && b.description.includes("response time"),
      );
      expect(net).toBeDefined();
      expect(net?.severity).toBe("high");
    });

    test("returns empty when everything is healthy", () => {
      monitor = new PerformanceMonitor();
      monitor.startSession();

      for (let i = 0; i < 20; i++) {
        monitor.recordRequest(true, 200);
        monitor.recordItemProcessed("stored");
      }

      // All requests succeeded, no rate limiting, latency is low.
      // Processing speed bottleneck only triggers if itemsPerSecond < 0.5 AND itemsProcessed > 10,
      // but since all 20 items process in ~0ms, speed will be very high (or Infinity).
      const bottlenecks = monitor.identifyBottlenecks();
      // Should not have rate_limit or network bottlenecks
      expect(bottlenecks.filter((b) => b.type === "rate_limit").length).toBe(0);
      expect(bottlenecks.filter((b) => b.type === "network").length).toBe(0);
    });
  });

  test("getMemoryTrend returns unknown with few samples", () => {
    monitor = new PerformanceMonitor();
    monitor.startSession();
    expect(monitor.getMemoryTrend()).toBe("unknown");
  });

  test("formatForDisplay returns non-empty string", () => {
    monitor = new PerformanceMonitor();
    monitor.startSession();
    monitor.recordRequest(true, 100, 1024);
    monitor.recordItemProcessed("stored");
    monitor.endSession();

    const display = monitor.formatForDisplay();
    expect(display.length).toBeGreaterThan(0);
    expect(display).toContain("Sync Performance Summary");
    expect(display).toContain("Network Statistics");
  });

  test("reset clears all metrics", () => {
    monitor = new PerformanceMonitor();
    monitor.startSession();
    monitor.recordRequest(true, 100);
    monitor.recordItemsFetched(10);
    monitor.reset();

    expect(monitor.getRequestMetrics().totalRequests).toBe(0);
    expect(monitor.getSyncMetrics().itemsFetched).toBe(0);
  });

  test("double startSession does not leak interval", () => {
    monitor = new PerformanceMonitor();
    monitor.startSession();
    monitor.recordRequest(true, 100);
    monitor.startSession(); // Should not leak first interval
    expect(monitor.getRequestMetrics().totalRequests).toBe(0);
    monitor.endSession();
  });

  describe("getMemoryTrend with data", () => {
    test("increasing trend detected", () => {
      monitor = new PerformanceMonitor();
      monitor.startSession();
      for (let i = 0; i < 5; i++) {
        monitor.recordMemorySample({
          timestamp: Date.now() + i * 1000,
          rssBytes: 100_000_000 + i * 20_000_000,
        });
      }
      expect(monitor.getMemoryTrend()).toBe("increasing");
    });

    test("decreasing trend detected", () => {
      monitor = new PerformanceMonitor();
      monitor.startSession();
      for (let i = 0; i < 5; i++) {
        monitor.recordMemorySample({
          timestamp: Date.now() + i * 1000,
          rssBytes: 200_000_000 - i * 30_000_000,
        });
      }
      expect(monitor.getMemoryTrend()).toBe("decreasing");
    });

    test("stable trend detected", () => {
      monitor = new PerformanceMonitor();
      monitor.startSession();
      for (let i = 0; i < 5; i++) {
        monitor.recordMemorySample({
          timestamp: Date.now() + i * 1000,
          rssBytes: 100_000_000 + (i % 2) * 1_000_000,
        });
      }
      expect(monitor.getMemoryTrend()).toBe("stable");
    });

    test("zero firstValue returns unknown", () => {
      monitor = new PerformanceMonitor();
      monitor.startSession();
      for (let i = 0; i < 5; i++) {
        monitor.recordMemorySample({
          timestamp: Date.now() + i * 1000,
          rssBytes: i === 0 ? 0 : 100_000_000,
        });
      }
      expect(monitor.getMemoryTrend()).toBe("unknown");
    });
  });

  test("getRequestMetrics returns independent copy", () => {
    monitor = new PerformanceMonitor();
    monitor.startSession();
    monitor.recordRequest(true, 100);

    const copy = monitor.getRequestMetrics();
    copy.requestTimestamps.push(999999);

    expect(monitor.getRequestMetrics().requestTimestamps.length).toBe(1);
  });

  test("getSyncMetrics returns independent copy", () => {
    monitor = new PerformanceMonitor();
    monitor.startSession(); // adds 1 baseline sample
    monitor.recordMemorySample({ timestamp: Date.now(), rssBytes: 100 });

    const originalLength = monitor.getSyncMetrics().memoryUsageSamples.length;
    const copy = monitor.getSyncMetrics();
    copy.memoryUsageSamples.push({ timestamp: 0, rssBytes: 0 });

    // Mutating the copy must not affect the original
    expect(monitor.getSyncMetrics().memoryUsageSamples.length).toBe(originalLength);
  });

  test("recordMemorySample caps at 100 samples, dropping oldest", () => {
    monitor = new PerformanceMonitor();
    for (let i = 0; i < 105; i++) {
      monitor.recordMemorySample({ timestamp: 1000 + i, rssBytes: i * 1024 });
    }
    const samples = monitor.getSyncMetrics().memoryUsageSamples;
    expect(samples.length).toBe(100);
    // Oldest 5 samples (indices 0-4) should have been dropped
    expect(samples[0].timestamp).toBe(1005);
    expect(samples[0].rssBytes).toBe(5 * 1024);
    expect(samples[99].timestamp).toBe(1104);
  });

  test("requestTimestamps stays bounded at window size", () => {
    monitor = new PerformanceMonitor();
    monitor.startSession();
    for (let i = 0; i < 150; i++) monitor.recordRequest(true, 10);
    expect(monitor.getRequestMetrics().requestTimestamps.length).toBe(100);
  });

  test("formatForDisplay includes bottleneck section when issues exist", () => {
    monitor = new PerformanceMonitor();
    monitor.startSession();
    // All requests failed and rate limited — triggers both bottleneck types
    for (let i = 0; i < 10; i++) monitor.recordRequest(false, 100, 0, true);
    monitor.endSession();
    const output = monitor.formatForDisplay();
    expect(output).toContain("Identified Issues");
    expect(output).toContain("Recommendation");
  });

  test("running average resets correctly across sessions", () => {
    monitor = new PerformanceMonitor();
    monitor.startSession();
    monitor.recordRequest(true, 1000);
    monitor.recordRequest(true, 2000);
    expect(monitor.getRequestMetrics().avgResponseTimeMs).toBe(1500);

    monitor.startSession();
    monitor.recordRequest(true, 100);
    expect(monitor.getRequestMetrics().avgResponseTimeMs).toBe(100);
  });

  // -----------------------------------------------------------------------
  // New coverage
  // -----------------------------------------------------------------------

  test("getCurrentRequestRate computes rate over window", async () => {
    monitor = new PerformanceMonitor();
    monitor.startSession();
    // Record requests with slight delay so timestamps differ
    monitor.recordRequest(true, 50);
    await new Promise((r) => setTimeout(r, 50));
    monitor.recordRequest(true, 50);
    await new Promise((r) => setTimeout(r, 50));
    monitor.recordRequest(true, 50);

    // With 3 timestamps spread over ~100ms, rate should be > 0
    const rate = monitor.getCurrentRequestRate();
    expect(rate).toBeGreaterThan(0);
  });

  test("getSummary works mid-session (endTime not set)", async () => {
    monitor = new PerformanceMonitor();
    monitor.startSession();
    await new Promise((r) => setTimeout(r, 10)); // ensure time advances
    monitor.recordRequest(true, 100);
    monitor.recordItemsFetched(10);
    for (let i = 0; i < 10; i++) monitor.recordItemProcessed("stored");

    // Don't call endSession — summary should still work using Date.now()
    const summary = monitor.getSummary();
    expect(summary.durationMs).toBeGreaterThan(0);
    expect(summary.requestSuccessRate).toBe(1);
  });

  test("identifyBottlenecks detects processing speed issue", () => {
    // To trigger: itemsPerSecond < 0.5 AND itemsProcessed > 10
    // Strategy: start session, process items, then manipulate startTime
    // so getSummary computes a long duration.
    monitor = new PerformanceMonitor();
    monitor.startSession();

    for (let i = 0; i < 15; i++) {
      monitor.recordItemProcessed("stored");
    }

    // Manipulate startTime to 60 seconds ago via getSyncMetrics/internal state.
    // endSession snapshots endTime. Then identifyBottlenecks uses getSummary
    // which computes: duration = endTime - startTime.
    // We set endTime to now and startTime to 60s ago: 15 items / 60s = 0.25 items/sec < 0.5
    // Use private field access to set startTime back
    (monitor as any).syncMetrics.startTime = Date.now() - 60_000;
    monitor.endSession();

    const bottlenecks = monitor.identifyBottlenecks();
    const processingBottleneck = bottlenecks.find((b) => b.type === "processing");
    expect(processingBottleneck).toBeDefined();
    expect(processingBottleneck!.severity).toBe("medium");
    expect(processingBottleneck!.description).toContain("items/second");
  });

  test("identifyBottlenecks detects network failure", () => {
    const mon = new PerformanceMonitor();
    mon.startSession();
    for (let i = 0; i < 10; i++) mon.recordRequest(false, 100);
    for (let i = 0; i < 2; i++) mon.recordRequest(true, 100);
    mon.endSession();
    const bottlenecks = mon.identifyBottlenecks();
    const networkBottleneck = bottlenecks.find((b) => b.type === "network");
    expect(networkBottleneck).toBeDefined();
    expect(networkBottleneck!.severity).toBe("high");
  });

  test("identifyBottlenecks detects rate limit issues", () => {
    monitor = new PerformanceMonitor();
    monitor.startSession();
    for (let i = 0; i < 10; i++) {
      monitor.recordRequest(true, 100, 0, i < 5); // 50% rate limited
    }
    monitor.endSession();

    const bottlenecks = monitor.identifyBottlenecks();
    const rl = bottlenecks.find((b) => b.type === "rate_limit");
    expect(rl).toBeDefined();
    expect(rl!.severity).toBe("high");
  });

  test("identifyBottlenecks detects high latency", () => {
    monitor = new PerformanceMonitor();
    monitor.startSession();
    monitor.recordRequest(true, 6000); // 6s avg
    monitor.endSession();

    const bottlenecks = monitor.identifyBottlenecks();
    const latency = bottlenecks.find(
      (b) => b.type === "network" && b.description.includes("response time"),
    );
    expect(latency).toBeDefined();
    expect(latency!.severity).toBe("high");
  });

  test("formatForDisplay produces non-empty output", () => {
    monitor = new PerformanceMonitor();
    monitor.startSession();
    monitor.recordRequest(true, 100, 1024);
    monitor.recordItemsFetched(5);
    for (let i = 0; i < 5; i++) monitor.recordItemProcessed("stored");
    monitor.endSession();

    const output = monitor.formatForDisplay();
    expect(output).toContain("Sync Performance Summary");
    expect(output).toContain("Items processed");
    expect(output).toContain("Total requests");
  });

  test("recordRateLimitWait does not record when not monitoring", () => {
    monitor = new PerformanceMonitor();
    // Do NOT call startSession
    monitor.recordRateLimitWait(1000);
    expect(monitor.getRequestMetrics().rateLimitWaitTimeMs).toBe(0);
  });

  test("effectiveThroughput is computed and positive", () => {
    monitor = new PerformanceMonitor();
    monitor.startSession();
    // Add rate limit wait time so effectiveThroughput differs from itemsPerSecond
    monitor.recordRateLimitWait(5000);
    for (let i = 0; i < 10; i++) monitor.recordItemProcessed("stored");
    // Manipulate startTime to 10 seconds ago for deterministic rates
    (monitor as any).syncMetrics.startTime = Date.now() - 10_000;
    monitor.endSession();

    const summary = monitor.getSummary();
    expect(summary.effectiveThroughput).toBeGreaterThan(0);
    // effectiveThroughput should be >= itemsPerSecond since rate limit time is excluded
    expect(summary.effectiveThroughput).toBeGreaterThanOrEqual(summary.itemsPerSecond);
  });

  test("effectiveThroughput uses 1s floor when rateLimitWait nearly equals duration", () => {
    monitor = new PerformanceMonitor();
    monitor.startSession();
    // Duration ~2s, rate limit wait ~1.9s → active time < 1s → floor at 1s
    (monitor as any).syncMetrics.startTime = Date.now() - 2000;
    monitor.recordRateLimitWait(1900);
    for (let i = 0; i < 5; i++) monitor.recordItemProcessed("stored");
    monitor.endSession();

    const summary = monitor.getSummary();
    // Without the floor, active time = 100ms → throughput = 50 items/sec (unrealistically high)
    // With the floor, active time = 1000ms → throughput = 5 items/sec
    expect(summary.effectiveThroughput).toBeCloseTo(5, 0);
    expect(summary.effectiveThroughput).toBeLessThan(10);
  });

  describe("identifyBottlenecks — medium severity tiers", () => {
    test("latency medium severity at 4000ms avg", () => {
      monitor = new PerformanceMonitor();
      monitor.startSession();
      monitor.recordRequest(true, 4000);
      monitor.endSession();

      const bottlenecks = monitor.identifyBottlenecks();
      const latency = bottlenecks.find(
        (b) => b.type === "network" && b.description.includes("response time"),
      );
      expect(latency).toBeDefined();
      expect(latency!.severity).toBe("medium");
    });

    test("network medium severity at 88% success rate", () => {
      monitor = new PerformanceMonitor();
      monitor.startSession();
      // 88 successes + 12 failures = 88% success rate
      for (let i = 0; i < 88; i++) monitor.recordRequest(true, 100);
      for (let i = 0; i < 12; i++) monitor.recordRequest(false, 100);
      monitor.endSession();

      const bottlenecks = monitor.identifyBottlenecks();
      const net = bottlenecks.find(
        (b) => b.type === "network" && b.description.includes("failed"),
      );
      expect(net).toBeDefined();
      expect(net!.severity).toBe("medium");
    });
  });

  describe("identifyBottlenecks — low severity tiers", () => {
    test("rate_limit low severity at 15% rate-limited", () => {
      monitor = new PerformanceMonitor();
      monitor.startSession();
      // 85 normal + 15 rate-limited = 15% rate limited
      for (let i = 0; i < 85; i++) monitor.recordRequest(true, 100, 0, false);
      for (let i = 0; i < 15; i++) monitor.recordRequest(true, 100, 0, true);
      monitor.endSession();

      const bottlenecks = monitor.identifyBottlenecks();
      const rl = bottlenecks.find((b) => b.type === "rate_limit");
      expect(rl).toBeDefined();
      expect(rl!.severity).toBe("low");
    });

    test("network low severity at 93% success rate", () => {
      monitor = new PerformanceMonitor();
      monitor.startSession();
      // 93 successes + 7 failures = 93% success rate
      for (let i = 0; i < 93; i++) monitor.recordRequest(true, 100);
      for (let i = 0; i < 7; i++) monitor.recordRequest(false, 100);
      monitor.endSession();

      const bottlenecks = monitor.identifyBottlenecks();
      const net = bottlenecks.find(
        (b) => b.type === "network" && b.description.includes("failed"),
      );
      expect(net).toBeDefined();
      expect(net!.severity).toBe("low");
    });

    test("latency low severity at 2500ms avg", () => {
      monitor = new PerformanceMonitor();
      monitor.startSession();
      monitor.recordRequest(true, 2500);
      monitor.endSession();

      const bottlenecks = monitor.identifyBottlenecks();
      const latency = bottlenecks.find(
        (b) => b.type === "network" && b.description.includes("response time"),
      );
      expect(latency).toBeDefined();
      expect(latency!.severity).toBe("low");
    });
  });
});

describe("formatDuration", () => {
  test("0ms", () => {
    expect(formatDuration(0)).toBe("0ms");
  });

  test("milliseconds", () => {
    expect(formatDuration(500)).toBe("500ms");
  });

  test("seconds", () => {
    expect(formatDuration(5500)).toBe("5.5s");
  });

  test("minutes", () => {
    expect(formatDuration(125000)).toBe("2m 5s");
  });

  test("hours", () => {
    expect(formatDuration(7265000)).toBe("2h 1m");
  });

  test("NaN returns N/A", () => {
    expect(formatDuration(Number.NaN)).toBe("N/A");
  });

  test("negative returns N/A", () => {
    expect(formatDuration(-1)).toBe("N/A");
  });

  test("Infinity returns N/A", () => {
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("N/A");
  });

  test("exactly 60000ms formats as minutes", () => {
    expect(formatDuration(60000)).toBe("1m 0s");
  });
});

describe("formatBytes", () => {
  test("zero bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  test("bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  test("kilobytes", () => {
    expect(formatBytes(2048)).toBe("2.0 KB");
  });

  test("megabytes", () => {
    expect(formatBytes(1_500_000)).toBe("1.4 MB");
  });

  test("gigabytes", () => {
    expect(formatBytes(2_500_000_000)).toBe("2.33 GB");
  });

  test("NaN returns N/A", () => {
    expect(formatBytes(Number.NaN)).toBe("N/A");
  });

  test("negative returns N/A", () => {
    expect(formatBytes(-1)).toBe("N/A");
  });
});

describe("PerformanceMonitor — session lifecycle", () => {
  let monitor: PerformanceMonitor;

  afterEach(() => {
    monitor?.reset();
  });

  test("recordRequest is a no-op when not monitoring", () => {
    monitor = new PerformanceMonitor();
    // Don't call startSession — recording should be ignored
    monitor.recordRequest(true, 100, 500);
    const metrics = monitor.getRequestMetrics();
    expect(metrics.totalRequests).toBe(0);
    expect(metrics.successfulRequests).toBe(0);
  });

  test("recordItemsFetched is a no-op when not monitoring", () => {
    monitor = new PerformanceMonitor();
    monitor.recordItemsFetched(50);
    const metrics = monitor.getSyncMetrics();
    expect(metrics.itemsFetched).toBe(0);
  });

  test("recordItemProcessed is a no-op when not monitoring", () => {
    monitor = new PerformanceMonitor();
    monitor.recordItemProcessed("stored");
    const metrics = monitor.getSyncMetrics();
    expect(metrics.itemsProcessed).toBe(0);
  });

  test("startSession called twice resets metrics cleanly", () => {
    monitor = new PerformanceMonitor();
    monitor.startSession();
    monitor.recordRequest(true, 100);
    monitor.recordItemsFetched(10);
    expect(monitor.getRequestMetrics().totalRequests).toBe(1);

    // Second startSession should reset everything
    monitor.startSession();
    expect(monitor.getRequestMetrics().totalRequests).toBe(0);
    expect(monitor.getSyncMetrics().itemsFetched).toBe(0);
    expect(monitor.getSyncMetrics().startTime).toBeGreaterThan(0);
  });

  test("formatForDisplay includes bottleneck section when issues exist", () => {
    monitor = new PerformanceMonitor();
    monitor.startSession();

    // Record a mix of successful and failed requests to trigger bottlenecks
    // (unrolled to work around Bun JIT issue with mixed-condition loops)
    monitor.recordRequest(true, 3500, 100, false);
    monitor.recordRequest(true, 3500, 100, false);
    monitor.recordRequest(true, 3500, 100, false);
    monitor.recordRequest(false, 3500, 100, false);
    monitor.recordRequest(false, 3500, 100, false);
    monitor.recordRequest(false, 3500, 100, true);

    monitor.recordItemsFetched(6);
    monitor.recordItemProcessed("stored");
    monitor.recordItemProcessed("stored");
    monitor.recordItemProcessed("stored");
    monitor.recordItemProcessed("failed");
    monitor.recordItemProcessed("failed");
    monitor.recordItemProcessed("failed");
    monitor.endSession();

    const output = monitor.formatForDisplay();
    expect(output).toContain("=== Sync Performance Summary ===");
    expect(output).toContain("--- Network Statistics ---");
    expect(output).toContain("--- Identified Issues ---");
    // Should have network failure bottleneck (50% success rate < 95%)
    expect(output).toContain("requests failed");
  });

  test("formatForDisplay omits bottleneck section when no issues", () => {
    monitor = new PerformanceMonitor();
    monitor.startSession();

    // All requests successful, fast response times
    for (let i = 0; i < 10; i++) {
      monitor.recordRequest(true, 100, 100);
    }
    monitor.endSession();

    const output = monitor.formatForDisplay();
    expect(output).toContain("=== Sync Performance Summary ===");
    expect(output).not.toContain("--- Identified Issues ---");
  });
});

describe("PerformanceMonitor — vacuous success rate", () => {
  test("getSummary returns requestSuccessRate=1 when no requests made", () => {
    const { PerformanceMonitor } = require("../src/monitor/performance");
    const monitor = new PerformanceMonitor();
    monitor.startSession();
    const summary = monitor.getSummary();
    expect(summary.requestSuccessRate).toBe(1);
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("PerformanceMonitor — minResponseTimeMs serialization (L1)", () => {
  test("minResponseTimeMs is 0 with no requests recorded", () => {
    const monitor = new PerformanceMonitor();
    const metrics = monitor.getRequestMetrics();
    expect(metrics.minResponseTimeMs).toBe(0);
  });

  test("minResponseTimeMs serializes as valid JSON number, not null", () => {
    const monitor = new PerformanceMonitor();
    monitor.startSession();
    monitor.recordRequest(true, 500);
    const json = JSON.stringify(monitor.getRequestMetrics());
    expect(json).not.toContain("null");
    const parsed = JSON.parse(json);
    expect(typeof parsed.minResponseTimeMs).toBe("number");
    expect(parsed.minResponseTimeMs).toBe(500);
  });

  test("first request sets minResponseTimeMs correctly", () => {
    const monitor = new PerformanceMonitor();
    monitor.startSession();
    monitor.recordRequest(true, 250);
    expect(monitor.getRequestMetrics().minResponseTimeMs).toBe(250);
  });

  test("tracks minimum across multiple requests", () => {
    const monitor = new PerformanceMonitor();
    monitor.startSession();
    monitor.recordRequest(true, 300);
    monitor.recordRequest(true, 100);
    monitor.recordRequest(true, 200);
    expect(monitor.getRequestMetrics().minResponseTimeMs).toBe(100);
  });
});

describe("PerformanceMonitor — multiple simultaneous bottlenecks", () => {
  test("detects rate_limit and network bottlenecks simultaneously", () => {
    const monitor = new PerformanceMonitor();
    monitor.startSession();

    // 60% rate-limited + 40% failures → both bottleneck types
    for (let i = 0; i < 4; i++) monitor.recordRequest(true, 100);
    for (let i = 0; i < 6; i++) monitor.recordRequest(false, 100, 0, true);

    monitor.endSession();

    const bottlenecks = monitor.identifyBottlenecks();
    const types = bottlenecks.map((b) => b.type);
    expect(types).toContain("rate_limit");
    expect(types).toContain("network");
  });
});
