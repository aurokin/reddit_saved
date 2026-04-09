import { describe, test, expect } from "bun:test";
import { CircuitBreaker, type CircuitBreakerConfig } from "../src/queue/circuit-breaker";

const config: CircuitBreakerConfig = {
  failureThreshold: 3,
  resetTimeoutMs: 200,
  successThreshold: 2,
  failureWindowMs: 5000,
};

describe("CircuitBreaker", () => {
  test("starts in closed state", () => {
    const cb = new CircuitBreaker(config);
    expect(cb.getState()).toBe("closed");
    expect(cb.allowRequest()).toBe(true);
  });

  test("opens after reaching failure threshold", () => {
    const cb = new CircuitBreaker(config);
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("closed");
    cb.recordFailure();
    expect(cb.getState()).toBe("open");
    expect(cb.allowRequest()).toBe(false);
  });

  test("transitions to half-open after reset timeout", async () => {
    const cb = new CircuitBreaker(config);
    for (let i = 0; i < 3; i++) cb.recordFailure();
    expect(cb.getState()).toBe("open");

    await Bun.sleep(350);
    expect(cb.allowRequest()).toBe(true);
    expect(cb.getState()).toBe("half-open");
  });

  test("closes after success threshold in half-open", async () => {
    const cb = new CircuitBreaker(config);
    for (let i = 0; i < 3; i++) cb.recordFailure();
    await Bun.sleep(350);
    cb.allowRequest(); // transitions to half-open

    cb.recordSuccess();
    expect(cb.getState()).toBe("half-open");
    cb.recordSuccess();
    expect(cb.getState()).toBe("closed");
  });

  test("re-opens immediately on failure in half-open", async () => {
    const cb = new CircuitBreaker(config);
    for (let i = 0; i < 3; i++) cb.recordFailure();
    await Bun.sleep(350);
    cb.allowRequest(); // half-open

    cb.recordFailure();
    expect(cb.getState()).toBe("open");
  });

  test("reset clears all state", () => {
    const cb = new CircuitBreaker(config);
    for (let i = 0; i < 3; i++) cb.recordFailure();
    expect(cb.getState()).toBe("open");

    cb.reset();
    expect(cb.getState()).toBe("closed");
    expect(cb.allowRequest()).toBe(true);
  });

  test("getTimeUntilRetry returns 0 when not open", () => {
    const cb = new CircuitBreaker(config);
    expect(cb.getTimeUntilRetry()).toBe(0);
  });

  test("getTimeUntilRetry returns positive when open", () => {
    const cb = new CircuitBreaker(config);
    for (let i = 0; i < 3; i++) cb.recordFailure();
    expect(cb.getTimeUntilRetry()).toBeGreaterThan(0);
  });

  test("blocks concurrent probes in half-open state", async () => {
    const cb = new CircuitBreaker(config);
    for (let i = 0; i < 3; i++) cb.recordFailure();
    await Bun.sleep(350);

    expect(cb.allowRequest()).toBe(true);   // first probe: allowed, flag set
    expect(cb.getState()).toBe("half-open");
    expect(cb.allowRequest()).toBe(false);  // second probe: blocked while first is in flight
  });

  test("old failures outside window are cleaned", async () => {
    const shortWindowConfig = { ...config, failureWindowMs: 100, failureThreshold: 3 };
    const cb = new CircuitBreaker(shortWindowConfig);
    cb.recordFailure();
    cb.recordFailure();
    await Bun.sleep(200);
    // cleanOldFailures runs in both allowRequest and recordFailure.
    // After cleanup, failure count should be 0, so request should be allowed
    expect(cb.allowRequest()).toBe(true);
    expect(cb.getState()).toBe("closed");
  });
});
