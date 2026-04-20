import { describe, expect, test } from "bun:test";
import { cn, formatNumber, formatRelative, parseTags } from "@/lib/utils";

describe("cn", () => {
  test("merges classes and dedupes conflicts", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-sm", null, undefined, "font-bold")).toBe("text-sm font-bold");
  });
});

describe("formatNumber", () => {
  test("leaves small numbers alone", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(42)).toBe("42");
  });

  test("uses k/M suffixes for large numbers", () => {
    expect(formatNumber(1500)).toBe("1.5k");
    expect(formatNumber(2_000_000)).toBe("2.0M");
  });
});

describe("formatRelative", () => {
  test("returns relative phrase for recent timestamps", () => {
    const tenSecondsAgo = Math.floor(Date.now() / 1000) - 10;
    expect(formatRelative(tenSecondsAgo)).toMatch(/ago|seconds|minute/);
  });
});

describe("parseTags", () => {
  test("splits on double-pipe and trims", () => {
    expect(parseTags("a||b|| c ")).toEqual(["a", "b", "c"]);
    expect(parseTags(null)).toEqual([]);
    expect(parseTags("")).toEqual([]);
  });
});
