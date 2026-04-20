import { describe, expect, test } from "bun:test";
import {
  DEFAULT_APP_BASE_URL,
  candidateBaseUrls,
  normalizeAppBaseUrl,
} from "./app-config.js";

describe("app config helpers", () => {
  test("falls back to the default app URL when unset", () => {
    expect(normalizeAppBaseUrl("")).toBe(DEFAULT_APP_BASE_URL);
  });

  test("accepts localhost and preserves custom ports", () => {
    expect(normalizeAppBaseUrl("http://localhost:4123")).toBe("http://localhost:4123");
    expect(candidateBaseUrls("http://localhost:4123")).toEqual([
      "http://localhost:4123",
      "http://127.0.0.1:4123",
    ]);
  });

  test("accepts 127.0.0.1 and derives the localhost twin", () => {
    expect(candidateBaseUrls("http://127.0.0.1:8777")).toEqual([
      "http://127.0.0.1:8777",
      "http://localhost:8777",
    ]);
  });

  test("rejects non-loopback origins", () => {
    expect(() => normalizeAppBaseUrl("http://192.168.1.20:3001")).toThrow(
      "The local app URL must point to localhost or 127.0.0.1.",
    );
  });
});
