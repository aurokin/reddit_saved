import type {
  Bottleneck,
  MemorySample,
  PerformanceSummary,
  RequestMetrics,
  SyncMetrics,
} from "../types";

const METRICS_WINDOW_SIZE = 100;

/**
 * Monitors and tracks performance metrics during sync operations.
 * Ported from reference performance-monitor.ts with:
 * - Media metrics stripped (this project doesn't download media)
 * - Chrome memory API replaced with process.memoryUsage().rss
 * - ImportMetrics renamed to SyncMetrics
 */
export class PerformanceMonitor {
  private requestMetrics: RequestMetrics;
  private syncMetrics: SyncMetrics;
  private responseTimeCount = 0;
  private responseTimeSum = 0;
  private isMonitoring = false;
  private memoryMonitorInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.requestMetrics = createEmptyRequestMetrics();
    this.syncMetrics = createEmptySyncMetrics();
  }

  /** Start monitoring a new sync session */
  startSession(): void {
    this.stopMemoryMonitoring(); // Prevent interval leak from double startSession()
    this.requestMetrics = createEmptyRequestMetrics();
    this.syncMetrics = createEmptySyncMetrics();
    this.syncMetrics.startTime = Date.now();
    this.responseTimeCount = 0;
    this.responseTimeSum = 0;
    this.isMonitoring = true;
    this.startMemoryMonitoring();
    this.sampleMemory(); // Capture baseline immediately so short sessions have at least one sample
  }

  /** End the monitoring session */
  endSession(): void {
    this.syncMetrics.endTime = Date.now();
    this.isMonitoring = false;
    this.stopMemoryMonitoring();
  }

  /** Record a request attempt */
  recordRequest(
    success: boolean,
    responseTimeMs: number,
    bytesDownloaded = 0,
    wasRateLimited = false,
  ): void {
    if (!this.isMonitoring) return;

    this.requestMetrics.totalRequests++;

    if (success) {
      this.requestMetrics.successfulRequests++;
    } else {
      this.requestMetrics.failedRequests++;
    }

    if (wasRateLimited) {
      this.requestMetrics.rateLimitedRequests++;
    }

    this.requestMetrics.totalBytesDownloaded += bytesDownloaded;

    // Running average — no unbounded array
    this.responseTimeCount++;
    this.responseTimeSum += responseTimeMs;
    this.requestMetrics.minResponseTimeMs = Math.min(
      this.requestMetrics.minResponseTimeMs,
      responseTimeMs,
    );
    this.requestMetrics.maxResponseTimeMs = Math.max(
      this.requestMetrics.maxResponseTimeMs,
      responseTimeMs,
    );
    this.requestMetrics.avgResponseTimeMs = this.responseTimeSum / this.responseTimeCount;

    const now = Date.now();
    this.requestMetrics.requestTimestamps.push(now);
    if (this.requestMetrics.requestTimestamps.length > METRICS_WINDOW_SIZE) {
      this.requestMetrics.requestTimestamps.shift();
    }
  }

  /** Record rate limit wait time */
  recordRateLimitWait(waitTimeMs: number): void {
    if (!this.isMonitoring) return;
    this.requestMetrics.rateLimitWaitTimeMs += waitTimeMs;
  }

  /** Record items fetched from API */
  recordItemsFetched(count: number): void {
    if (!this.isMonitoring) return;
    this.syncMetrics.itemsFetched += count;
  }

  /** Record item processed */
  recordItemProcessed(result: "stored" | "skipped" | "failed"): void {
    if (!this.isMonitoring) return;
    this.syncMetrics.itemsProcessed++;

    switch (result) {
      case "stored":
        this.syncMetrics.itemsStored++;
        break;
      case "skipped":
        this.syncMetrics.itemsSkipped++;
        break;
      case "failed":
        this.syncMetrics.itemsFailed++;
        break;
    }
  }

  /** Get current request metrics (deep copy — safe to mutate) */
  getRequestMetrics(): RequestMetrics {
    return {
      ...this.requestMetrics,
      minResponseTimeMs: Number.isFinite(this.requestMetrics.minResponseTimeMs)
        ? this.requestMetrics.minResponseTimeMs
        : 0,
      requestTimestamps: [...this.requestMetrics.requestTimestamps],
    };
  }

  /** Get current sync metrics (deep copy — safe to mutate) */
  getSyncMetrics(): SyncMetrics {
    return {
      ...this.syncMetrics,
      memoryUsageSamples: [...this.syncMetrics.memoryUsageSamples],
    };
  }

  /** Get performance summary */
  getSummary(): PerformanceSummary {
    const endTime = this.syncMetrics.endTime || Date.now();
    const durationMs = endTime - this.syncMetrics.startTime;
    const durationSeconds = durationMs / 1000;

    const itemsPerSecond =
      durationSeconds > 0 ? this.syncMetrics.itemsProcessed / durationSeconds : 0;

    const requestSuccessRate =
      this.requestMetrics.totalRequests > 0
        ? this.requestMetrics.successfulRequests / this.requestMetrics.totalRequests
        : 1;

    const rateLimitPercentage =
      this.requestMetrics.totalRequests > 0
        ? this.requestMetrics.rateLimitedRequests / this.requestMetrics.totalRequests
        : 0;

    const totalActiveTime = Math.max(1000, durationMs - this.requestMetrics.rateLimitWaitTimeMs);
    const effectiveThroughput =
      totalActiveTime > 0 ? (this.syncMetrics.itemsProcessed / totalActiveTime) * 1000 : 0;

    return {
      durationMs,
      itemsPerSecond,
      avgRequestLatencyMs: this.requestMetrics.avgResponseTimeMs,
      requestSuccessRate,
      rateLimitPercentage,
      effectiveThroughput,
    };
  }

  /** Calculate current request rate (requests per second over recent window) */
  getCurrentRequestRate(): number {
    const timestamps = this.requestMetrics.requestTimestamps;
    if (timestamps.length < 2) return 0;

    const windowMs = timestamps[timestamps.length - 1] - timestamps[0];
    if (windowMs <= 0) return 0;

    return ((timestamps.length - 1) / windowMs) * 1000;
  }

  /** Identify performance bottlenecks */
  identifyBottlenecks(): Bottleneck[] {
    const bottlenecks: Bottleneck[] = [];
    const summary = this.getSummary();

    if (summary.rateLimitPercentage > 0.1) {
      const severity =
        summary.rateLimitPercentage > 0.3
          ? "high"
          : summary.rateLimitPercentage > 0.2
            ? "medium"
            : "low";
      bottlenecks.push({
        type: "rate_limit",
        severity,
        description: `${(summary.rateLimitPercentage * 100).toFixed(1)}% of requests were rate limited`,
        recommendation: "Consider reducing fetch limit or waiting between sync sessions",
      });
    }

    if (summary.requestSuccessRate < 0.95) {
      const severity =
        summary.requestSuccessRate < 0.8
          ? "high"
          : summary.requestSuccessRate < 0.9
            ? "medium"
            : "low";
      bottlenecks.push({
        type: "network",
        severity,
        description: `${((1 - summary.requestSuccessRate) * 100).toFixed(1)}% of requests failed`,
        recommendation: "Check network connection or increase retry attempts",
      });
    }

    if (this.requestMetrics.avgResponseTimeMs > 2000) {
      const severity =
        this.requestMetrics.avgResponseTimeMs > 5000
          ? "high"
          : this.requestMetrics.avgResponseTimeMs > 3000
            ? "medium"
            : "low";
      bottlenecks.push({
        type: "network",
        severity,
        description: `Average response time is ${this.requestMetrics.avgResponseTimeMs.toFixed(0)}ms`,
        recommendation: "Network latency is high; consider syncing during off-peak hours",
      });
    }

    if (summary.itemsPerSecond < 0.5 && this.syncMetrics.itemsProcessed > 10) {
      bottlenecks.push({
        type: "processing",
        severity: "medium",
        description: `Processing speed is ${summary.itemsPerSecond.toFixed(2)} items/second`,
        recommendation: "Large items or complex content may be slowing sync",
      });
    }

    return bottlenecks;
  }

  /** Get memory trend based on recent samples */
  getMemoryTrend(): "stable" | "increasing" | "decreasing" | "unknown" {
    const samples = this.syncMetrics.memoryUsageSamples;
    if (samples.length < 5) return "unknown";

    const recentSamples = samples.slice(-5);
    const firstValue = recentSamples[0].rssBytes;
    const lastValue = recentSamples[recentSamples.length - 1].rssBytes;

    if (firstValue === 0) return "unknown";

    const percentChange = ((lastValue - firstValue) / firstValue) * 100;

    if (percentChange > 10) return "increasing";
    if (percentChange < -10) return "decreasing";
    return "stable";
  }

  /** Format metrics for display */
  formatForDisplay(): string {
    const summary = this.getSummary();
    const metrics = this.getSyncMetrics();
    const bottlenecks = this.identifyBottlenecks();

    const lines: string[] = [
      "=== Sync Performance Summary ===",
      "",
      `Duration: ${formatDuration(summary.durationMs)}`,
      `Items processed: ${metrics.itemsProcessed} (${metrics.itemsStored} stored, ${metrics.itemsSkipped} skipped, ${metrics.itemsFailed} failed)`,
      `Processing speed: ${summary.itemsPerSecond.toFixed(2)} items/second`,
      `Effective throughput: ${summary.effectiveThroughput.toFixed(2)} items/second`,
      "",
      "--- Network Statistics ---",
      `Total requests: ${this.requestMetrics.totalRequests}`,
      `Success rate: ${(summary.requestSuccessRate * 100).toFixed(1)}%`,
      `Rate limited: ${this.requestMetrics.rateLimitedRequests} (${(summary.rateLimitPercentage * 100).toFixed(1)}%)`,
      `Avg response time: ${this.requestMetrics.avgResponseTimeMs.toFixed(0)}ms`,
      `Rate limit wait time: ${formatDuration(this.requestMetrics.rateLimitWaitTimeMs)}`,
      `Data downloaded: ${formatBytes(this.requestMetrics.totalBytesDownloaded)}`,
    ];

    if (bottlenecks.length > 0) {
      lines.push("", "--- Identified Issues ---");
      for (const bottleneck of bottlenecks) {
        lines.push(`[${bottleneck.severity.toUpperCase()}] ${bottleneck.description}`);
        lines.push(`  Recommendation: ${bottleneck.recommendation}`);
      }
    }

    return lines.join("\n");
  }

  /** Reset all metrics */
  reset(): void {
    this.requestMetrics = createEmptyRequestMetrics();
    this.syncMetrics = createEmptySyncMetrics();
    this.responseTimeCount = 0;
    this.responseTimeSum = 0;
    this.isMonitoring = false;
    this.stopMemoryMonitoring();
  }

  // --------------------------------------------------------------------------
  // Memory monitoring
  // --------------------------------------------------------------------------

  private startMemoryMonitoring(): void {
    this.memoryMonitorInterval = setInterval(() => {
      this.sampleMemory();
    }, 5000);
    // Allow the process to exit even if the interval is still running
    if (this.memoryMonitorInterval && typeof this.memoryMonitorInterval.unref === "function") {
      this.memoryMonitorInterval.unref();
    }
  }

  private stopMemoryMonitoring(): void {
    if (this.memoryMonitorInterval) {
      clearInterval(this.memoryMonitorInterval);
      this.memoryMonitorInterval = null;
    }
  }

  /** Record a memory sample (public for testability).
   *  Intentionally has no isMonitoring guard — unlike request/sync metrics,
   *  memory samples are valid context even outside an active session. The
   *  private sampleMemory() interval only runs during sessions anyway. */
  recordMemorySample(sample: MemorySample): void {
    this.syncMetrics.memoryUsageSamples.push(sample);
    if (this.syncMetrics.memoryUsageSamples.length > 100) {
      this.syncMetrics.memoryUsageSamples.shift();
    }
  }

  private sampleMemory(): void {
    this.recordMemorySample({
      timestamp: Date.now(),
      rssBytes: process.memoryUsage().rss,
    });
  }
}

// ============================================================================
// Helpers (exported for direct testing)
// ============================================================================

function createEmptyRequestMetrics(): RequestMetrics {
  return {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    rateLimitedRequests: 0,
    totalBytesDownloaded: 0,
    avgResponseTimeMs: 0,
    minResponseTimeMs: Number.POSITIVE_INFINITY,
    maxResponseTimeMs: 0,
    rateLimitWaitTimeMs: 0,
    requestTimestamps: [],
  };
}

function createEmptySyncMetrics(): SyncMetrics {
  return {
    startTime: 0,
    itemsFetched: 0,
    itemsProcessed: 0,
    itemsStored: 0,
    itemsSkipped: 0,
    itemsFailed: 0,
    memoryUsageSamples: [],
  };
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "N/A";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "N/A";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
