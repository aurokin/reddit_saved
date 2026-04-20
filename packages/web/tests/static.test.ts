import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { resolveDistAssetPath, shouldServeSpaFallback } from "@/api/static";

describe("shouldServeSpaFallback", () => {
  test("allows route-like URLs", () => {
    expect(shouldServeSpaFallback("/")).toBe(true);
    expect(shouldServeSpaFallback("/settings")).toBe(true);
    expect(shouldServeSpaFallback("/posts/abc123")).toBe(true);
  });

  test("rejects asset and file-like URLs", () => {
    expect(shouldServeSpaFallback("/assets/index-oldhash.js")).toBe(false);
    expect(shouldServeSpaFallback("/assets/chunk")).toBe(false);
    expect(shouldServeSpaFallback("/favicon.ico")).toBe(false);
    expect(shouldServeSpaFallback("/site.webmanifest")).toBe(false);
  });
});

describe("resolveDistAssetPath", () => {
  const distDir = "/tmp/reddit-saved-dist";

  test("resolves request paths relative to dist", () => {
    expect(resolveDistAssetPath(distDir, "/assets/index-abc123.js")).toBe(
      resolve(distDir, "assets/index-abc123.js"),
    );
    expect(resolveDistAssetPath(distDir, "/favicon.ico")).toBe(
      resolve(distDir, "favicon.ico"),
    );
  });

  test("returns null for the root route and traversal attempts", () => {
    expect(resolveDistAssetPath(distDir, "/")).toBeNull();
    expect(resolveDistAssetPath(distDir, "/../etc/passwd")).toBeNull();
  });
});
