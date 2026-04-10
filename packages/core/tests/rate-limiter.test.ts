import { describe, expect, test } from "bun:test";
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

  test("updateFromHeaders floors negative remaining at 0", () => {
    const rl = new RateLimiter(60, 60000);
    rl.updateFromHeaders(-5, 60);
    expect(rl.getAvailableTokens()).toBeCloseTo(0, 0);
  });

  test("updateFromHeaders with resetSeconds=0 does not change window", () => {
    const rl = new RateLimiter(60, 60000);
    rl.updateFromHeaders(5, 0);
    expect(rl.getAvailableTokens()).toBeCloseTo(5, 0);
    // Exhaust all tokens and check wait reflects original window
    for (let i = 0; i < 60; i++) rl.tryAcquire();
    const wait = rl.getWaitTime();
    // Original: 60000ms / 60 tokens = 1000ms per token
    expect(wait).toBeGreaterThan(500);
    expect(wait).toBeLessThanOrEqual(1100);
  });

  test("updateFromHeaders with resetSeconds=-1 does not change window", () => {
    const rl = new RateLimiter(60, 60000);
    rl.updateFromHeaders(5, -1);
    expect(rl.getAvailableTokens()).toBeCloseTo(5, 0);
    for (let i = 0; i < 60; i++) rl.tryAcquire();
    const wait = rl.getWaitTime();
    expect(wait).toBeGreaterThan(500);
    expect(wait).toBeLessThanOrEqual(1100);
  });

  test("updateFromHeaders caps resetSeconds at 600 (10 minutes)", () => {
    const rl = new RateLimiter(60, 60000);
    // Pass a very large reset — should cap at 600s = 600000ms
    rl.updateFromHeaders(30, 99999);
    // Verify by checking that the window didn't become huge
    // After consuming all tokens, the wait time should reflect the capped window
    for (let i = 0; i < 60; i++) rl.tryAcquire();
    const wait = rl.getWaitTime();
    // With 600s window and 60 tokens, 1 token takes 10s = 10000ms
    expect(wait).toBeLessThanOrEqual(10_100); // 10s + small margin
    expect(wait).toBeGreaterThan(0);
  });
});
