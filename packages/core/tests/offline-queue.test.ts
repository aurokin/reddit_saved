import { describe, expect, test } from "bun:test";
import { OfflineQueue } from "../src/queue/offline-queue";
import type { RequestParams } from "../src/types";

function makeParams(url = "https://example.com"): RequestParams {
  return { url };
}

describe("OfflineQueue", () => {
  test("add returns true when queue has space", () => {
    const q = new OfflineQueue(10);
    expect(q.add(makeParams())).toBe(true);
    expect(q.size()).toBe(1);
  });

  test("add fills to capacity", () => {
    const q = new OfflineQueue(3);
    expect(q.add(makeParams("a"))).toBe(true);
    expect(q.add(makeParams("b"))).toBe(true);
    expect(q.add(makeParams("c"))).toBe(true);
    expect(q.size()).toBe(3);
  });

  test("add evicts low-priority when full and incoming is higher priority", () => {
    const q = new OfflineQueue(2);
    q.add(makeParams("a"), "low");
    q.add(makeParams("b"), "normal");
    expect(q.size()).toBe(2);

    // High-priority should evict the low-priority entry
    expect(q.add(makeParams("c"), "high")).toBe(true);
    expect(q.size()).toBe(2);

    const drained = q.drain();
    expect(drained[0].params.url).toBe("c"); // high first
    expect(drained.some((r) => r.params.url === "a")).toBe(false); // low was evicted
  });

  test("add returns false for low-priority when full (no self-eviction)", () => {
    const q = new OfflineQueue(2);
    q.add(makeParams("a"), "low");
    q.add(makeParams("b"), "low");

    expect(q.add(makeParams("c"), "low")).toBe(false);
    expect(q.size()).toBe(2);
  });

  test("add returns false when full and no evictable entry", () => {
    const q = new OfflineQueue(2);
    q.add(makeParams("a"), "high");
    q.add(makeParams("b"), "high");

    // Normal can't evict high
    expect(q.add(makeParams("c"), "normal")).toBe(false);
    expect(q.size()).toBe(2);
  });

  test("normal-priority evicts low-priority when full", () => {
    const q = new OfflineQueue(1);
    q.add(makeParams("a"), "low");

    expect(q.add(makeParams("b"), "normal")).toBe(true);
    expect(q.size()).toBe(1);

    const drained = q.drain();
    expect(drained[0].params.url).toBe("b");
  });

  test("drain returns entries sorted by priority", () => {
    const q = new OfflineQueue(10);
    q.add(makeParams("low1"), "low");
    q.add(makeParams("high1"), "high");
    q.add(makeParams("normal1"), "normal");
    q.add(makeParams("high2"), "high");
    q.add(makeParams("low2"), "low");

    const drained = q.drain();
    expect(drained.length).toBe(5);

    // High first, then normal, then low
    expect(drained[0].priority).toBe("high");
    expect(drained[1].priority).toBe("high");
    expect(drained[2].priority).toBe("normal");
    expect(drained[3].priority).toBe("low");
    expect(drained[4].priority).toBe("low");
  });

  test("drain empties the queue", () => {
    const q = new OfflineQueue(10);
    q.add(makeParams("a"));
    q.add(makeParams("b"));

    q.drain();
    expect(q.size()).toBe(0);
  });

  test("clear empties the queue", () => {
    const q = new OfflineQueue(10);
    q.add(makeParams("a"));
    q.add(makeParams("b"));

    q.clear();
    expect(q.size()).toBe(0);
  });

  test("evicts first-added low-priority item when multiple lows exist", () => {
    const q = new OfflineQueue(3);
    q.add(makeParams("low1"), "low");
    q.add(makeParams("low2"), "low");
    q.add(makeParams("normal1"), "normal");

    // Full — high-priority should evict the first low ("low1")
    expect(q.add(makeParams("high1"), "high")).toBe(true);
    expect(q.size()).toBe(3);

    const drained = q.drain();
    const urls = drained.map((r) => r.params.url);
    // Verify exact drain order: high → normal → low
    expect(urls).toEqual(["high1", "normal1", "low2"]);
  });

  test("high-priority cannot evict normal entries when no lows exist", () => {
    const q = new OfflineQueue(2);
    q.add(makeParams("a"), "normal");
    q.add(makeParams("b"), "normal");

    // Queue is full of normals — high cannot evict them (only lows are evictable)
    expect(q.add(makeParams("c"), "high")).toBe(false);
    expect(q.size()).toBe(2);
  });

  test("high-priority cannot evict other high-priority entries", () => {
    const q = new OfflineQueue(2);
    q.add(makeParams("a"), "high");
    q.add(makeParams("b"), "high");

    // Queue full of highs — no low to evict
    expect(q.add(makeParams("c"), "high")).toBe(false);
    expect(q.size()).toBe(2);
  });
});
