/**
 * Circuit breaker states:
 * - closed: normal operation, requests pass through
 * - open: too many failures, requests are rejected
 * - half-open: testing if service has recovered
 */
export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit */
  failureThreshold: number;
  /** Time in ms before attempting to close circuit */
  resetTimeoutMs: number;
  /** Number of successful requests needed to close circuit from half-open */
  successThreshold: number;
  /** Time window for counting failures */
  failureWindowMs: number;
}

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private successCount = 0;
  private lastFailureTime = 0;
  private failures: number[] = [];
  private halfOpenProbeInFlight = false;
  private config: CircuitBreakerConfig;

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
  }

  getState(): CircuitState {
    return this.state;
  }

  /** Check if a request should be allowed through */
  allowRequest(): boolean {
    this.cleanOldFailures();

    switch (this.state) {
      case "closed":
        return true;
      case "open":
        if (Date.now() - this.lastFailureTime >= this.config.resetTimeoutMs) {
          this.state = "half-open";
          this.successCount = 0;
          this.failures = []; // prevent stale failures influencing re-evaluation after probe
          this.halfOpenProbeInFlight = true; // block further probes until this one settles
          return true;
        }
        return false;
      case "half-open":
        if (this.halfOpenProbeInFlight) return false;
        this.halfOpenProbeInFlight = true;
        return true;
    }
  }

  recordSuccess(): void {
    if (this.state === "half-open") {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.state = "closed";
        this.successCount = 0;
        this.failures = [];
        this.halfOpenProbeInFlight = false;
      } else {
        this.halfOpenProbeInFlight = false; // allow next sequential probe
      }
    }
  }

  /** Release a half-open probe slot without recording success or failure.
   * Used when the outcome is ambiguous (e.g., 2xx response but body read failed,
   * or request was aborted/timed out). */
  releaseProbe(): void {
    if (this.state === "half-open") {
      this.halfOpenProbeInFlight = false;
    }
  }

  recordFailure(): void {
    const now = Date.now();
    this.failures.push(now);
    this.cleanOldFailures();

    if (this.state === "half-open") {
      // Half-open probe failed — reopen with fresh cooldown
      this.halfOpenProbeInFlight = false;
      this.lastFailureTime = now;
      this.state = "open";
      this.successCount = 0;
    } else if (this.state === "closed") {
      // Only update lastFailureTime when transitioning to open, not from
      // in-flight requests that fail after the circuit already opened
      if (this.failures.length >= this.config.failureThreshold) {
        this.lastFailureTime = now;
        this.state = "open";
      }
    }
    // state === "open": in-flight request failed after circuit opened.
    // Don't update lastFailureTime — that would indefinitely defer half-open probing.
  }

  /** Get ms until circuit might transition to half-open */
  getTimeUntilRetry(): number {
    if (this.state !== "open") return 0;
    const elapsed = Date.now() - this.lastFailureTime;
    return Math.max(0, this.config.resetTimeoutMs - elapsed);
  }

  reset(): void {
    this.state = "closed";
    this.successCount = 0;
    this.failures = [];
    this.lastFailureTime = 0;
    this.halfOpenProbeInFlight = false;
  }

  private cleanOldFailures(): void {
    const cutoff = Date.now() - this.config.failureWindowMs;
    this.failures = this.failures.filter((time) => time > cutoff);
  }
}
