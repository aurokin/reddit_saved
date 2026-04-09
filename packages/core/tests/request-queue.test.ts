import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { RequestQueue } from "../src/queue/request-queue";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Poll until predicate is true. Throws on timeout for clear failure diagnostics. */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

// ---------------------------------------------------------------------------
// Mock HTTP server — responds based on URL path
// ---------------------------------------------------------------------------

let mockServer: Server<unknown>;
let baseUrl: string;
const latchWaiters: Array<(res: Response) => void> = [];
let slowHitCount = 0;

beforeAll(() => {
  mockServer = Bun.serve({
    port: 0, // random available port
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/ok") {
        return Response.json(
          { status: "ok" },
          {
            headers: {
              "x-ratelimit-remaining": "59",
              "x-ratelimit-reset": "60",
            },
          },
        );
      }

      if (url.pathname === "/slow") {
        slowHitCount++;
        return new Promise<Response>((resolve, reject) => {
          const id = setTimeout(() => resolve(Response.json({ status: "slow" })), 5000);
          req.signal.addEventListener("abort", () => {
            clearTimeout(id);
            reject(new Error("aborted"));
          });
        });
      }

      if (url.pathname === "/500") {
        return new Response("Internal Server Error", { status: 500 });
      }

      if (url.pathname === "/503") {
        return new Response("Service Unavailable", { status: 503 });
      }

      if (url.pathname === "/404") {
        return new Response("Not Found", { status: 404 });
      }

      if (url.pathname === "/429") {
        return new Response("Rate Limited", {
          status: 429,
          headers: { "retry-after": "1" },
        });
      }

      if (url.pathname === "/count") {
        return Response.json({ ts: Date.now() });
      }

      if (url.pathname === "/latch") {
        // Block until /release is called — used to test concurrency limits
        return new Promise<Response>((resolve, reject) => {
          latchWaiters.push(resolve);
          req.signal.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        });
      }

      if (url.pathname === "/release") {
        const waiter = latchWaiters.shift();
        if (waiter) waiter(Response.json({ status: "released" }));
        return Response.json({ released: !!waiter });
      }

      return new Response("Unknown", { status: 400 });
    },
  });
  baseUrl = `http://127.0.0.1:${mockServer.port}`;
});

afterAll(() => {
  mockServer.stop(true);
});

// Reset shared mutable state before each test to prevent cross-test contamination
// (e.g. a failed latch test leaving stale entries that affect the next test).
beforeEach(() => {
  latchWaiters.length = 0;
  slowHitCount = 0;
});

afterEach(() => {
  // Resolve any dangling latch promises so the mock server doesn't accumulate
  // unresolved Promise<Response> objects across tests
  for (const waiter of latchWaiters) {
    waiter(new Response("cleanup", { status: 503 }));
  }
  latchWaiters.length = 0;
  slowHitCount = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RequestQueue", () => {
  test("enqueue and receive a successful response", async () => {
    const q = new RequestQueue();
    const res = await q.enqueue({ url: `${baseUrl}/ok` });
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).status).toBe("ok");
  });

  test("parses JSON response body", async () => {
    const q = new RequestQueue();
    const res = await q.enqueue({ url: `${baseUrl}/ok` });
    expect(res.body).toEqual({ status: "ok" });
    expect(res.text).toBe('{"status":"ok"}');
  });

  test("rejects on 4xx without retry", async () => {
    const q = new RequestQueue({ maxRetries: 2, baseBackoffMs: 10 });
    const start = Date.now();
    await expect(q.enqueue({ url: `${baseUrl}/404` }, { maxRetries: 0 })).rejects.toThrow("404");
    // Should fail immediately without retries
    expect(Date.now() - start).toBeLessThan(1000);
  });

  test("retries on 5xx with backoff", async () => {
    const q = new RequestQueue({ maxRetries: 2, baseBackoffMs: 50, maxBackoffMs: 200 });
    await expect(q.enqueue({ url: `${baseUrl}/500` }, { maxRetries: 2 })).rejects.toThrow("500");
  });

  test("handles 429 rate limiting", async () => {
    const q = new RequestQueue({ maxRetries: 1, baseBackoffMs: 50 });
    await expect(q.enqueue({ url: `${baseUrl}/429` }, { maxRetries: 1 })).rejects.toThrow("429");
  });

  test("times out slow requests without retrying", async () => {
    const q = new RequestQueue({ defaultTimeoutMs: 200 });
    const start = Date.now();
    try {
      await q.enqueue({ url: `${baseUrl}/slow` }, { timeout: 200, maxRetries: 2 });
      throw new Error("Expected timeout");
    } catch (err) {
      expect((err as Error).name).toBe("TimeoutError");
    }
    // Should fail fast despite maxRetries: 2 — timeout errors are not retried
    expect(Date.now() - start).toBeLessThan(2000);
    // Verify exactly 1 HTTP attempt was made (no retries on timeout).
    // slowHitCount is reset to 0 in beforeEach.
    expect(slowHitCount).toBe(1);
  });

  test("pause stops processing, resume restarts", async () => {
    const q = new RequestQueue({ maxConcurrent: 1 });
    q.pause();

    let resolved = false;
    const promise = q.enqueue({ url: `${baseUrl}/ok` }).then(() => {
      resolved = true;
    });

    // Give it a moment — should NOT resolve while paused
    await new Promise((r) => setTimeout(r, 200));
    expect(resolved).toBe(false);

    q.resume();
    await promise;
    expect(resolved).toBe(true);
  });

  test("clear rejects all pending requests", async () => {
    const q = new RequestQueue({ maxConcurrent: 1 });
    q.pause();

    const promises = [
      q.enqueue({ url: `${baseUrl}/ok` }).catch((e: Error) => e.message),
      q.enqueue({ url: `${baseUrl}/ok` }).catch((e: Error) => e.message),
    ];

    q.clear();
    const results = await Promise.all(promises);
    expect(results.every((r) => r === "Queue cleared")).toBe(true);
  });

  test("getStatus reports queue state", () => {
    const q = new RequestQueue();
    const status = q.getStatus();
    expect(status.queueLength).toBe(0);
    expect(status.activeRequests).toBe(0);
    expect(status.isPaused).toBe(false);
    expect(status.isOnline).toBe(true);
    expect(status.circuitState).toBe("closed");
  });

  test("offline mode buffers requests", async () => {
    const q = new RequestQueue();
    q.setOnline(false);

    await expect(q.enqueue({ url: `${baseUrl}/ok` })).rejects.toThrow("Offline");
    expect(q.getStatus().offlineQueueSize).toBe(1);
    q.clear();
  });

  test("setOnline(true) drains offline queue", async () => {
    const q = new RequestQueue();
    q.setOnline(false);

    // Buffer a request while offline
    await q.enqueue({ url: `${baseUrl}/ok` }).catch(() => {});
    expect(q.getStatus().offlineQueueSize).toBe(1);

    // Go back online — buffered request should be re-enqueued and completed
    q.setOnline(true);
    expect(q.getStatus().offlineQueueSize).toBe(0);

    // Wait for the drain to complete, then verify the request finished
    await waitFor(() => q.getStatus().activeRequests === 0 && q.getStatus().queueLength === 0);
    expect(q.getStatus().activeRequests).toBe(0);
    expect(q.getStatus().queueLength).toBe(0);
  });

  test("circuit breaker opens after repeated failures", async () => {
    const q = new RequestQueue({
      maxRetries: 0,
      circuitBreaker: {
        failureThreshold: 2,
        resetTimeoutMs: 30_000,
        successThreshold: 1,
        failureWindowMs: 60_000,
      },
    });

    // Trigger failures to open the circuit
    for (let i = 0; i < 2; i++) {
      try {
        await q.enqueue({ url: `${baseUrl}/500` });
      } catch {
        /* expected */
      }
    }

    expect(q.getStatus().circuitState).toBe("open");
  });

  test("respects maxConcurrent limit", async () => {
    const q = new RequestQueue({ maxConcurrent: 2 });

    // Enqueue 3 requests to the latch endpoint — they block until released
    const p1 = q.enqueue({ url: `${baseUrl}/latch` });
    const p2 = q.enqueue({ url: `${baseUrl}/latch` });
    const p3 = q.enqueue({ url: `${baseUrl}/latch` });

    // Wait for the first 2 to be dispatched (poll instead of fixed sleep)
    await waitFor(() => latchWaiters.length === 2);

    // Only 2 should be in flight (the latch array holds them)
    expect(latchWaiters.length).toBe(2);

    // Release the first 2 — the 3rd should then dispatch
    await fetch(`${baseUrl}/release`);
    await fetch(`${baseUrl}/release`);
    await waitFor(() => latchWaiters.length === 1);

    expect(latchWaiters.length).toBe(1);

    // Release the last one
    await fetch(`${baseUrl}/release`);
    await Promise.all([p1, p2, p3]);
  });

  test("priority ordering dispatches high before low", async () => {
    const q = new RequestQueue({ maxConcurrent: 1 });
    q.pause();

    const order: string[] = [];

    const p1 = q.enqueue({ url: `${baseUrl}/ok` }, { priority: "low" }).then(() => {
      order.push("low");
    });
    const p2 = q.enqueue({ url: `${baseUrl}/ok` }, { priority: "high" }).then(() => {
      order.push("high");
    });
    const p3 = q.enqueue({ url: `${baseUrl}/ok` }, { priority: "normal" }).then(() => {
      order.push("normal");
    });

    q.resume();
    await Promise.all([p1, p2, p3]);

    expect(order[0]).toBe("high");
    expect(order[1]).toBe("normal");
    expect(order[2]).toBe("low");
  });

  test("queue-wait time reduces HTTP timeout budget", async () => {
    // Budget must exceed the 1s floor in executeRequest (Math.max(1000, budget))
    // so that the deducted budget is actually used, not the floor.
    const TOTAL_TIMEOUT = 4000;
    const QUEUE_WAIT = 1500;
    const FLOOR = 1000; // production code: Math.max(1000, budget)
    const q = new RequestQueue({ maxConcurrent: 1 });

    // Block the queue with a latch request
    const p1 = q.enqueue({ url: `${baseUrl}/latch` });

    // Ensure the latch is in flight before enqueuing p2
    await waitFor(() => latchWaiters.length === 1);

    // Record when p2 enters the queue, then wait for budget to be consumed
    const queuedAt = Date.now();
    const p2 = q.enqueue({ url: `${baseUrl}/slow` }, { timeout: TOTAL_TIMEOUT });

    // Wait until enough queue time has elapsed. /slow takes 5s → will timeout.
    await new Promise((r) => setTimeout(r, QUEUE_WAIT));
    const actualQueueWait = Date.now() - queuedAt;
    const remainingBudget = TOTAL_TIMEOUT - actualQueueWait;

    // Guard: if CI was so slow that remaining budget is at or below the floor,
    // the test can't distinguish budget deduction from the floor. Skip gracefully.
    if (remainingBudget <= FLOOR) {
      await fetch(`${baseUrl}/release`);
      await p1;
      await p2.catch(() => {}); // drain
      return; // can't assert meaningfully on this run
    }

    // Release p1 — p2 dispatches with reduced remaining budget
    const dispatchTime = Date.now();
    await fetch(`${baseUrl}/release`);

    // p2 should timeout well before its original full budget from dispatch time
    try {
      await p2;
      throw new Error("Expected timeout");
    } catch (err) {
      expect((err as Error).name).toBe("TimeoutError");
      const elapsed = Date.now() - dispatchTime;
      // The remaining budget is TOTAL_TIMEOUT - actualQueueWait.
      // Assert the timeout fired within that budget (with generous margin for scheduling).
      // This proves real budget deduction: elapsed < remainingBudget + margin < TOTAL_TIMEOUT.
      expect(elapsed).toBeLessThan(remainingBudget + 500);
      // Also verify we're meaningfully below the full TOTAL_TIMEOUT
      expect(elapsed).toBeLessThan(TOTAL_TIMEOUT);
    }
    await p1;
  });
});
