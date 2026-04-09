import { describe, test, expect } from "bun:test";
import { RateLimiter } from "../src/queue/rate-limiter";

describe("RateLimiter", () => {
  test("allows requests up to max tokens", () => {
    const rl = new RateLimiter(5, 1000);
    for (let i = 0; i < 5; i++) {
      expect(rl.tryAcquire()).toBe(true);
    }
    expect(rl.tryAcquire()).toBe(false);
  });

  test("getWaitTime returns 0 when tokens available", () => {
    const rl = new RateLimiter(10, 1000);
    expect(rl.getWaitTime()).toBe(0);
  });

  test("getWaitTime returns positive when exhausted", () => {
    const rl = new RateLimiter(2, 1000);
    rl.tryAcquire();
    rl.tryAcquire();
    expect(rl.getWaitTime()).toBeGreaterThan(0);
  });

  test("refills tokens over time", async () => {
    const rl = new RateLimiter(10, 200); // 10 tokens per 200ms
    for (let i = 0; i < 10; i++) rl.tryAcquire();
    expect(rl.tryAcquire()).toBe(false);

    await Bun.sleep(300);
    expect(rl.tryAcquire()).toBe(true);
  });

  test("getAvailableTokens reflects current state", () => {
    const rl = new RateLimiter(5, 1000);
    expect(rl.getAvailableTokens()).toBeCloseTo(5, 0);
    rl.tryAcquire();
    expect(rl.getAvailableTokens()).toBeLessThan(5);
  });

  test("updateFromHeaders adjusts tokens downward", () => {
    const rl = new RateLimiter(60, 60000);
    rl.updateFromHeaders(10, 30);
    // Small time-based refill may occur between update and check
    expect(rl.getAvailableTokens()).toBeCloseTo(10, 0);
  });

  test("updateFromHeaders clamps remaining to maxTokens", () => {
    const rl = new RateLimiter(60, 60000);
    // Server reports more remaining than local max — should clamp to exactly 60
    rl.updateFromHeaders(100, 60);
    expect(rl.getAvailableTokens()).toBe(60);
  });
});
