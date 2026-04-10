import {
  BACKOFF_MAX_DELAY_MS,
  CIRCUIT_BREAKER_FAILURE_THRESHOLD,
  CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
  MAX_REQUEST_RETRIES,
  RATE_LIMIT_INTERVAL_MS,
  RATE_LIMIT_TOKENS,
} from "../constants";
import type { RequestParams, RequestResponse } from "../types";
import { CircuitBreaker, type CircuitBreakerConfig, type CircuitState } from "./circuit-breaker";
import { OfflineQueue, type RequestPriority } from "./offline-queue";
import { RateLimiter } from "./rate-limiter";

// ============================================================================
// Config
// ============================================================================

export interface RequestQueueConfig {
  maxConcurrent: number;
  /** Per-attempt HTTP timeout in ms. Note: retries reset the budget, so this
   *  bounds each individual HTTP attempt, not total wall-clock time. */
  defaultTimeoutMs: number;
  /** Maximum total wall-clock time a request may reside in the queue (including
   *  retries). Requests exceeding this are rejected before consuming resources.
   *  Default: 5 minutes. */
  maxQueueTimeMs: number;
  maxRetries: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  rateLimitRequests: number;
  rateLimitWindowMs: number;
  circuitBreaker: CircuitBreakerConfig;
}

const DEFAULT_CONFIG: RequestQueueConfig = {
  maxConcurrent: 2,
  defaultTimeoutMs: 30_000,
  maxQueueTimeMs: 300_000,
  maxRetries: MAX_REQUEST_RETRIES,
  baseBackoffMs: 1000,
  maxBackoffMs: BACKOFF_MAX_DELAY_MS,
  rateLimitRequests: RATE_LIMIT_TOKENS,
  rateLimitWindowMs: RATE_LIMIT_INTERVAL_MS,
  circuitBreaker: {
    failureThreshold: CIRCUIT_BREAKER_FAILURE_THRESHOLD,
    resetTimeoutMs: CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
    successThreshold: 2,
    failureWindowMs: 60_000,
  },
};

// ============================================================================
// Internal types
// ============================================================================

interface QueuedRequest {
  id: string;
  params: RequestParams;
  priority: RequestPriority;
  resolve: (response: RequestResponse) => void;
  reject: (error: Error) => void;
  retryCount: number;
  maxRetries: number;
  /** Timestamp of the original enqueue call. Never reset on retry.
   *  Used for total wall-clock queue residence expiry. */
  enqueuedAt: number;
  /** Timestamp of the most recent (re-)queue. Reset on retry.
   *  Used to compute per-attempt HTTP timeout budget. */
  addedAt: number;
  timeout: number;
}

export interface RequestQueueStatus {
  queueLength: number;
  activeRequests: number;
  circuitState: CircuitState;
  availableTokens: number;
  isPaused: boolean;
  isOnline: boolean;
  offlineQueueSize: number;
}

// ============================================================================
// RequestQueue
// ============================================================================

/**
 * Request queue with circuit breaker, token-bucket rate limiting,
 * exponential backoff, priority ordering, and offline buffering.
 *
 * Uses native fetch() + AbortSignal.timeout() instead of Obsidian's requestUrl.
 */
export class RequestQueue {
  private config: RequestQueueConfig;
  private queue: QueuedRequest[] = [];
  private activeRequests = 0;
  private circuitBreaker: CircuitBreaker;
  private rateLimiter: RateLimiter;
  private offlineQueue: OfflineQueue;
  private isProcessing = false;
  private isPaused = false;
  private isOnline = true;
  private requestIdCounter = 0;

  constructor(config: Partial<RequestQueueConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      circuitBreaker: { ...DEFAULT_CONFIG.circuitBreaker, ...config.circuitBreaker },
    };
    this.circuitBreaker = new CircuitBreaker(this.config.circuitBreaker);
    this.rateLimiter = new RateLimiter(
      this.config.rateLimitRequests,
      this.config.rateLimitWindowMs,
    );
    this.offlineQueue = new OfflineQueue();
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  async enqueue(
    params: RequestParams,
    options: {
      priority?: RequestPriority;
      maxRetries?: number;
      timeout?: number;
    } = {},
  ): Promise<RequestResponse> {
    return new Promise((resolve, reject) => {
      const now = Date.now();
      const request: QueuedRequest = {
        id: `req-${++this.requestIdCounter}`,
        params,
        priority: options.priority ?? "normal",
        resolve,
        reject,
        retryCount: 0,
        maxRetries: options.maxRetries ?? this.config.maxRetries,
        enqueuedAt: now,
        addedAt: now,
        timeout: options.timeout ?? this.config.defaultTimeoutMs,
      };

      this.insertByPriority(request);
      this.processQueue();
    });
  }

  pause(): void {
    this.isPaused = true;
  }

  resume(): void {
    this.isPaused = false;
    this.processQueue();
  }

  /** Set online/offline state. When transitioning to online, buffered offline
   *  requests are re-enqueued as new fire-and-forget requests. The original
   *  callers' promises were already rejected with "Offline" and are not settled
   *  by the re-enqueued requests. */
  setOnline(online: boolean): void {
    const wasOffline = !this.isOnline;
    this.isOnline = online;

    if (online && wasOffline) {
      const offlineRequests = this.offlineQueue.drain();
      for (const { params, priority } of offlineRequests) {
        this.enqueue(params, { priority }).catch(() => {});
      }
    }
  }

  getStatus(): RequestQueueStatus {
    return {
      queueLength: this.queue.length,
      activeRequests: this.activeRequests,
      circuitState: this.circuitBreaker.getState(),
      availableTokens: this.rateLimiter.getAvailableTokens(),
      isPaused: this.isPaused,
      isOnline: this.isOnline,
      offlineQueueSize: this.offlineQueue.size(),
    };
  }

  /** Reject all queued (not yet dispatched) requests and clear the offline queue.
   *  In-flight requests are NOT aborted — pass an AbortSignal via params.signal
   *  if cancellation of active requests is needed. */
  clear(): void {
    for (const request of this.queue) {
      request.reject(new Error("Queue cleared"));
    }
    this.queue = [];
    this.offlineQueue.clear();
  }

  resetCircuitBreaker(): void {
    this.circuitBreaker.reset();
  }

  getPendingCount(): number {
    return this.queue.length + this.activeRequests;
  }

  // --------------------------------------------------------------------------
  // Queue processing — non-blocking: breaks out and schedules re-entry
  // instead of awaiting delays inside the processing lock.
  // --------------------------------------------------------------------------

  private processQueue(): void {
    if (this.isProcessing || this.isPaused) return;
    this.isProcessing = true;

    try {
      while (
        this.queue.length > 0 &&
        this.activeRequests < this.config.maxConcurrent &&
        !this.isPaused
      ) {
        // Discard requests that have exceeded their total wall-clock queue budget
        while (this.queue.length > 0) {
          const head = this.queue[0] as QueuedRequest;
          if (Date.now() - head.enqueuedAt > this.config.maxQueueTimeMs) {
            this.queue.shift();
            head.reject(new Error("Request timed out while waiting in queue"));
            continue;
          }
          break;
        }
        if (this.queue.length === 0) break;

        if (!this.isOnline) {
          for (const req of this.queue) {
            if (hasAuthHeader(req.params)) {
              // Auth-bearing requests cannot be replayed — tokens expire and
              // refreshing requires network. Reject immediately instead of
              // buffering a request that will 401 on replay.
              req.reject(new Error("Offline: auth-required requests cannot be replayed"));
            } else {
              const stored = this.offlineQueue.add(req.params, req.priority);
              req.reject(
                new Error(
                  stored
                    ? "Offline: request queued for later"
                    : "Offline: queue full, request dropped",
                ),
              );
            }
          }
          this.queue = [];
          break;
        }

        // Circuit breaker first: returning false from open state consumes no resources.
        // If it transitions to half-open and claims the probe slot, the rate limiter
        // check below will release it if we can't actually dispatch.
        if (!this.circuitBreaker.allowRequest()) {
          const waitTime = this.circuitBreaker.getTimeUntilRetry();
          setTimeout(() => this.processQueue(), Math.max(100, waitTime));
          break;
        }

        if (!this.rateLimiter.tryAcquire()) {
          // Release half-open probe if one was just claimed — we can't dispatch.
          this.circuitBreaker.releaseProbe();
          const waitTime = this.rateLimiter.getWaitTime();
          setTimeout(() => this.processQueue(), Math.max(100, waitTime));
          break;
        }

        const request = this.queue.shift() as QueuedRequest;
        this.activeRequests++;
        this.executeRequest(request).finally(() => {
          this.activeRequests = Math.max(0, this.activeRequests - 1);
          if (this.queue.length > 0 && !this.isPaused) {
            this.processQueue();
          }
        });
      }
    } finally {
      this.isProcessing = false;
      // Guard against stalls: if items remain after a setTimeout-driven re-entry
      // exits early (e.g., two close-together callbacks racing on isProcessing),
      // schedule another drain attempt. Uses setTimeout(0) instead of queueMicrotask
      // to yield to pending macrotasks (backoff timers, circuit breaker resets).
      if (this.queue.length > 0 && !this.isPaused && this.activeRequests < this.config.maxConcurrent) {
        setTimeout(() => this.processQueue(), 0);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Request execution — delays release the concurrency slot immediately
  // and schedule re-queue via setTimeout instead of blocking.
  // --------------------------------------------------------------------------

  private async executeRequest(request: QueuedRequest): Promise<void> {
    // Flag to prevent the outer catch from double-recording circuit breaker state
    // when the inner stream-read catch already handled it. A boolean is immune to
    // primitive throws and object-identity issues that WeakSet would have.
    let cbHandled = false;

    try {
      // Deduct queue-wait time from the HTTP timeout budget so the total
      // wall-clock time (queue + fetch) never exceeds the requested timeout.
      // Retries reset addedAt (lines below), so retried requests get a fresh budget.
      const elapsed = Date.now() - request.addedAt;
      const budget = request.timeout - elapsed;
      if (budget <= 0) {
        // Budget already exhausted while waiting in queue — reject immediately
        // rather than granting an extended lease via the 1s floor.
        this.circuitBreaker.releaseProbe();
        request.reject(new DOMException("The operation timed out.", "TimeoutError"));
        return;
      }
      // Floor at 1s so very-small-but-positive budgets still allow a real HTTP attempt.
      // Note: this floor means effective max overshoot is ~1s beyond maxQueueTimeMs.
      const remainingTimeout = Math.max(1000, budget);
      const response = await this.doFetch(request.params, remainingTimeout);

      // Update rate limiter from Reddit's response headers.
      // Guard against malformed headers — NaN tokens would permanently stall the queue.
      const rawRemaining = Number.parseFloat(response.headers.get("x-ratelimit-remaining") ?? "");
      const rawReset = Number.parseFloat(response.headers.get("x-ratelimit-reset") ?? "");
      this.rateLimiter.updateFromHeaders(
        Number.isFinite(rawRemaining) ? rawRemaining : this.config.rateLimitRequests,
        Number.isFinite(rawReset) && rawReset > 0 ? rawReset : 60,
      );

      let text: string;
      try {
        text = await response.text();
      } catch (streamErr) {
        // Mid-stream body read failure on a 2xx response. The server responded
        // successfully but we failed to read the body (OOM, stream reset, etc.).
        // Release the half-open probe without counting as success or failure —
        // the server is healthy but we can't use the response.
        cbHandled = true;
        this.circuitBreaker.releaseProbe();
        request.reject(streamErr instanceof Error ? streamErr : new Error(String(streamErr)));
        return; // Don't retry — the server already responded, retrying makes a new request
      }

      // Record success only after body is fully consumed
      this.circuitBreaker.recordSuccess();
      const contentType = response.headers.get("content-type") ?? "";
      let body: unknown = null;
      if (text && contentType.includes("json")) {
        try {
          body = JSON.parse(text);
        } catch {
          body = null;
        }
      }

      request.resolve({
        status: response.status,
        headers: response.headers,
        body,
        text,
      });
    } catch (error) {
      const err = error as Error & { status?: number; headers?: Headers };

      // Don't retry abort/timeout — these are intentional cancellations.
      // Release half-open probe so circuit breaker isn't permanently stuck.
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        this.circuitBreaker.releaseProbe();
        request.reject(err);
        return;
      }

      // Handle 429 rate limiting — not a service fault, don't trip circuit breaker.
      // Release half-open probe if one was claimed — 429 is not a health signal.
      if (err.status === 429) {
        this.circuitBreaker.releaseProbe();
        const rawRetryAfter = Number.parseInt(err.headers?.get("retry-after") ?? "", 10);
        const retryAfter =
          Number.isFinite(rawRetryAfter) && rawRetryAfter > 0 ? rawRetryAfter * 1000 : 60_000;
        if (request.retryCount < request.maxRetries) {
          request.retryCount++;
          setTimeout(() => {
            request.addedAt = Date.now(); // stamp at re-queue time, not scheduling time
            this.insertByPriority(request);
            this.processQueue();
          }, retryAfter);
          return;
        }
        // Retries exhausted — reject without tripping breaker
        request.reject(err);
        return;
      }

      // Only trip circuit breaker for service-side faults (5xx, network errors), not client errors (4xx).
      // Skip if the inner stream-read catch already handled this error's circuit breaker effect.
      if (!cbHandled && isCircuitBreakerFault(err)) {
        this.circuitBreaker.recordFailure();
      } else if (!cbHandled) {
        // Non-fault error (e.g. 4xx, unexpected throw) — release probe so
        // circuit breaker isn't permanently stuck in half-open.
        this.circuitBreaker.releaseProbe();
      }

      // Retry with exponential backoff for retryable errors — release slot, re-queue after delay
      if (request.retryCount < request.maxRetries && isRetryableError(err)) {
        request.retryCount++;
        const backoffMs = calculateBackoff(
          request.retryCount,
          this.config.baseBackoffMs,
          this.config.maxBackoffMs,
        );
        setTimeout(() => {
          request.addedAt = Date.now(); // stamp at re-queue time, not scheduling time
          this.insertByPriority(request);
          this.processQueue();
        }, backoffMs);
        return;
      }

      request.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Native fetch with AbortSignal.timeout() for true cancellation.
   * The caller's signal (if any) is combined with the timeout signal.
   */
  private async doFetch(params: RequestParams, timeoutMs: number): Promise<Response> {
    const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)];
    if (params.signal) signals.push(params.signal);

    const combinedSignal = signals.length === 1 ? signals[0] : AbortSignal.any(signals);

    const response = await fetch(params.url, {
      method: params.method ?? "GET",
      headers: params.headers,
      body: params.body,
      signal: combinedSignal,
    });

    // Throw an enriched error for non-2xx so retry logic can inspect status
    if (!response.ok) {
      // Drain body to free the connection — race against a timeout so slow error
      // bodies don't block indefinitely after the fetch signal has fired.
      try {
        await Promise.race([
          response.body?.cancel(),
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error("cancel timeout")), 2000),
          ),
        ]);
      } catch {
        /* ignore stream/timeout errors */
      }
      const err = new Error(`HTTP ${response.status}: ${response.statusText}`) as Error & {
        status: number;
        headers: Headers;
      };
      err.status = response.status;
      err.headers = response.headers;
      throw err;
    }

    return response;
  }

  // --------------------------------------------------------------------------
  // Priority insertion
  // --------------------------------------------------------------------------

  private insertByPriority(request: QueuedRequest): void {
    if (request.priority === "high") {
      const idx = this.queue.findIndex((r) => r.priority !== "high");
      if (idx >= 0) {
        this.queue.splice(idx, 0, request);
      } else {
        this.queue.push(request);
      }
    } else if (request.priority === "low") {
      this.queue.push(request);
    } else {
      const idx = this.queue.findIndex((r) => r.priority === "low");
      if (idx >= 0) {
        this.queue.splice(idx, 0, request);
      } else {
        this.queue.push(request);
      }
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function isRetryableError(error: Error & { status?: number }): boolean {
  // Abort/timeout are handled by the early return above; exclude defensively
  // so reordering the catch block doesn't silently enable retries.
  if (error.name === "AbortError" || error.name === "TimeoutError") return false;
  if (!error.status) return true; // network errors
  if (error.status >= 500 && error.status < 600) return true;
  if (error.status === 408) return true; // server-side timeout — retryable but not a circuit breaker fault
  return false;
}

/** Should this error count as a service fault for the circuit breaker?
 * Only network errors and 5xx — not 4xx client errors (401, 403, 404, etc.) */
function isCircuitBreakerFault(error: Error & { status?: number }): boolean {
  if (!error.status) return true; // network errors
  return error.status >= 500 && error.status < 600;
}

/** Exponential backoff with jitter. `retryCount` must already be incremented (1-based). */
function calculateBackoff(retryCount: number, baseMs: number, maxMs: number): number {
  const raw = baseMs * 2 ** (retryCount - 1);
  const jitter = raw * Math.random() * 0.25;
  return Math.min(raw + jitter, maxMs);
}

/** Check whether params carry an Authorization header (case-insensitive). */
function hasAuthHeader(params: RequestParams): boolean {
  if (!params.headers) return false;
  return Object.keys(params.headers).some((k) => k.toLowerCase() === "authorization");
}
