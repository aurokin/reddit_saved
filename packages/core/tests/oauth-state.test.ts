import { describe, expect, test } from "bun:test";
import { type OAuthPendingState, createPendingState, validateState } from "../src/auth/oauth-state";

describe("createPendingState", () => {
  test("returns state with all required fields", () => {
    const pending = createPendingState();
    expect(typeof pending.state).toBe("string");
    expect(pending.state.length).toBeGreaterThan(0);
    expect(typeof pending.codeVerifier).toBe("string");
    expect(pending.codeVerifier.length).toBeGreaterThan(0);
    expect(typeof pending.expiresAt).toBe("number");
    expect(pending.expiresAt).toBeGreaterThan(Date.now());
  });

  test("returnTo is undefined when not provided", () => {
    const pending = createPendingState();
    expect(pending.returnTo).toBeUndefined();
  });

  test("includes returnTo when provided", () => {
    const pending = createPendingState("http://localhost:3001");
    expect(pending.returnTo).toBe("http://localhost:3001");
  });

  test("generates unique states", () => {
    const a = createPendingState();
    const b = createPendingState();
    expect(a.state).not.toBe(b.state);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });
});

describe("validateState", () => {
  test("returns entry for valid state and removes it from map", () => {
    const pending = createPendingState("http://localhost:3001");
    const map = new Map<string, OAuthPendingState>();
    map.set(pending.state, pending);

    const result = validateState(pending.state, map);
    expect(result).not.toBeNull();
    expect(result?.state).toBe(pending.state);
    expect(result?.returnTo).toBe("http://localhost:3001");
    // Must be consumed (single-use)
    expect(map.has(pending.state)).toBe(false);
  });

  test("returns null for unknown state", () => {
    const map = new Map<string, OAuthPendingState>();
    expect(validateState("nonexistent", map)).toBeNull();
  });

  test("returns null for expired state and removes it", () => {
    const pending = createPendingState();
    // Force expiry
    pending.expiresAt = Date.now() - 1000;
    const map = new Map<string, OAuthPendingState>();
    map.set(pending.state, pending);

    const result = validateState(pending.state, map);
    expect(result).toBeNull();
    expect(map.has(pending.state)).toBe(false);
  });

  test("second validation of same state returns null (single-use)", () => {
    const pending = createPendingState();
    const map = new Map<string, OAuthPendingState>();
    map.set(pending.state, pending);

    const first = validateState(pending.state, map);
    expect(first).not.toBeNull();

    const second = validateState(pending.state, map);
    expect(second).toBeNull();
  });
});
