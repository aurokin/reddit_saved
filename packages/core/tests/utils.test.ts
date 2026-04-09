import { describe, test, expect } from "bun:test";
import { decodeHtmlEntities, escapeHtml } from "../src/utils/html-escape";
import { sanitizeFilename } from "../src/utils/file-sanitizer";
import { generateState } from "../src/auth/crypto";

describe("decodeHtmlEntities", () => {
  test("decodes common entities", () => {
    expect(decodeHtmlEntities("&amp;")).toBe("&");
    expect(decodeHtmlEntities("&lt;b&gt;")).toBe("<b>");
    expect(decodeHtmlEntities("&quot;hello&quot;")).toBe('"hello"');
  });

  test("decodes multiple entities in URL", () => {
    expect(decodeHtmlEntities("https://example.com?a=1&amp;b=2&amp;c=3")).toBe(
      "https://example.com?a=1&b=2&c=3",
    );
  });

  test("leaves plain text unchanged", () => {
    expect(decodeHtmlEntities("hello world")).toBe("hello world");
  });

  test("decodes decimal numeric entities", () => {
    expect(decodeHtmlEntities("&#65;")).toBe("A");
    expect(decodeHtmlEntities("&#8364;")).toBe("€");
  });

  test("decodes hex numeric entities", () => {
    expect(decodeHtmlEntities("&#x41;")).toBe("A");
    expect(decodeHtmlEntities("&#x20AC;")).toBe("€");
  });

  test("leaves invalid codepoints unchanged", () => {
    // Surrogate codepoint — should not crash, returns original
    expect(decodeHtmlEntities("&#xD800;")).toBe("&#xD800;");
    // Zero codepoint
    expect(decodeHtmlEntities("&#0;")).toBe("&#0;");
  });
});

describe("escapeHtml", () => {
  test("escapes all dangerous characters", () => {
    expect(escapeHtml('<script>alert("XSS")</script>')).toBe(
      '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;',
    );
  });

  test("escapes ampersands", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  test("escapes single quotes", () => {
    expect(escapeHtml("it's")).toBe("it&#39;s");
  });

  test("leaves plain text unchanged", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });
});

describe("sanitizeFilename", () => {
  test("replaces unsafe characters", () => {
    expect(sanitizeFilename('file<>:"/\\|?*name')).toBe("file_________name");
  });

  test("trims leading dots and spaces", () => {
    expect(sanitizeFilename("...hidden")).toBe("hidden");
    expect(sanitizeFilename("  spaced  ")).toBe("spaced");
  });

  test("truncates to max byte length", () => {
    const long = "a".repeat(300);
    const result = sanitizeFilename(long);
    expect(result.length).toBeLessThanOrEqual(200);
    expect(new TextEncoder().encode(result).byteLength).toBeLessThanOrEqual(200);
  });

  test("truncates multi-byte characters to max byte length", () => {
    // Each emoji is 4 bytes in UTF-8
    const multibyte = "\u{1F600}".repeat(100); // 400 bytes
    const result = sanitizeFilename(multibyte);
    expect(new TextEncoder().encode(result).byteLength).toBeLessThanOrEqual(200);
  });

  test("returns 'untitled' for empty result", () => {
    expect(sanitizeFilename("...")).toBe("untitled");
    expect(sanitizeFilename("")).toBe("untitled");
  });

  test("collapses multiple spaces", () => {
    expect(sanitizeFilename("hello   world")).toBe("hello world");
  });

  test("prefixes Windows reserved device names", () => {
    expect(sanitizeFilename("CON")).toBe("_CON");
    expect(sanitizeFilename("NUL")).toBe("_NUL");
    expect(sanitizeFilename("COM1")).toBe("_COM1");
    expect(sanitizeFilename("LPT3.txt")).toBe("_LPT3.txt");
  });
});

describe("generateState", () => {
  test("returns hex string of expected length", () => {
    const state = generateState(32);
    expect(state.length).toBe(64); // 32 bytes = 64 hex chars
    expect(/^[0-9a-f]+$/.test(state)).toBe(true);
  });

  test("generates unique values", () => {
    const a = generateState();
    const b = generateState();
    expect(a).not.toBe(b);
  });
});
