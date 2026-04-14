import { afterEach, describe, expect, test } from "bun:test";
import {
  formatPostForOutput,
  isHumanMode,
  printError,
  printInfo,
  printJson,
  printSection,
  printTable,
  printVerbose,
  printWarning,
  setOutputMode,
} from "../src/output";
import { captureConsole } from "./helpers";

describe("setOutputMode / isHumanMode", () => {
  afterEach(() => {
    setOutputMode(false, false, false);
  });

  test("defaults to JSON mode", () => {
    expect(isHumanMode()).toBe(false);
  });

  test("sets human mode", () => {
    setOutputMode(true, false, false);
    expect(isHumanMode()).toBe(true);
  });
});

describe("formatPostForOutput", () => {
  test("formats a post row", () => {
    const result = formatPostForOutput({
      id: "abc123",
      kind: "t3",
      title: "Test Post",
      subreddit: "test",
      author: "testuser",
      score: 42,
      permalink: "/r/test/comments/abc123/test_post/",
      created_utc: 1700000000,
    });

    expect(result.id).toBe("abc123");
    expect(result.kind).toBe("post");
    expect(result.title).toBe("Test Post");
    expect(result.subreddit).toBe("test");
    expect(result.permalink).toBe("https://reddit.com/r/test/comments/abc123/test_post/");
  });

  test("formats a comment row", () => {
    const result = formatPostForOutput({
      id: "def456",
      kind: "t1",
      title: null,
      link_title: "Parent Post Title",
      subreddit: "test",
      author: "commenter",
      score: 10,
      permalink: "/r/test/comments/abc123/test/def456/",
      created_utc: 1700000000,
    });

    expect(result.kind).toBe("comment");
    expect(result.title).toBe("Parent Post Title");
  });

  test("uses (untitled) when no title", () => {
    const result = formatPostForOutput({
      id: "x",
      kind: "t3",
      title: null,
      subreddit: "test",
      author: "u",
      score: 0,
      permalink: "/r/test/x/",
      created_utc: 0,
    });
    expect(result.title).toBe("(untitled)");
  });

  test("includes tags when present", () => {
    const result = formatPostForOutput({
      id: "x",
      kind: "t3",
      title: "T",
      subreddit: "s",
      author: "a",
      score: 0,
      permalink: "/p",
      created_utc: 0,
      tags: "ml,rust",
    });
    expect(result.tags).toBe("ml,rust");
  });

  test("excludes tags when null", () => {
    const result = formatPostForOutput({
      id: "x",
      kind: "t3",
      title: "T",
      subreddit: "s",
      author: "a",
      score: 0,
      permalink: "/p",
      created_utc: 0,
      tags: null,
    });
    expect(result.tags).toBeUndefined();
  });

  test("includes snippet when present", () => {
    const result = formatPostForOutput({
      id: "x",
      kind: "t3",
      title: "T",
      subreddit: "s",
      author: "a",
      score: 0,
      permalink: "/p",
      created_utc: 0,
      snippet: "matched <b>text</b>",
    });
    expect(result.snippet).toBe("matched <b>text</b>");
  });
});

describe("printJson", () => {
  test("outputs valid JSON to stdout", () => {
    const cap = captureConsole();
    try {
      printJson({ key: "value", num: 42 });
      const parsed = JSON.parse(cap.logs[0]);
      expect(parsed.key).toBe("value");
      expect(parsed.num).toBe(42);
    } finally {
      cap.restore();
    }
  });
});

describe("printError", () => {
  afterEach(() => setOutputMode(false, false, false));

  test("outputs JSON error to stderr in JSON mode", () => {
    setOutputMode(false, false, false);
    const cap = captureConsole();
    try {
      printError("something failed", "ERR_CODE");
      const parsed = JSON.parse(cap.errors[0]);
      expect(parsed.error).toBe("something failed");
      expect(parsed.code).toBe("ERR_CODE");
    } finally {
      cap.restore();
    }
  });

  test("outputs human-readable error in human mode", () => {
    setOutputMode(true, false, false);
    const cap = captureConsole();
    try {
      printError("something failed");
      expect(cap.errors[0]).toBe("Error: something failed");
    } finally {
      cap.restore();
    }
  });

  test("omits code when not provided in JSON mode", () => {
    setOutputMode(false, false, false);
    const cap = captureConsole();
    try {
      printError("oops");
      const parsed = JSON.parse(cap.errors[0]);
      expect(parsed.error).toBe("oops");
      expect(parsed.code).toBeUndefined();
    } finally {
      cap.restore();
    }
  });
});

describe("printWarning", () => {
  afterEach(() => setOutputMode(false, false, false));

  test("outputs JSON warning to stderr", () => {
    setOutputMode(false, false, false);
    const cap = captureConsole();
    try {
      printWarning("watch out");
      const parsed = JSON.parse(cap.errors[0]);
      expect(parsed.warning).toBe("watch out");
    } finally {
      cap.restore();
    }
  });

  test("outputs human-readable warning in human mode", () => {
    setOutputMode(true, false, false);
    const cap = captureConsole();
    try {
      printWarning("watch out");
      expect(cap.errors[0]).toBe("Warning: watch out");
    } finally {
      cap.restore();
    }
  });

  test("suppressed in quiet mode", () => {
    setOutputMode(false, false, true);
    const cap = captureConsole();
    try {
      printWarning("watch out");
      expect(cap.errors.length).toBe(0);
    } finally {
      cap.restore();
    }
  });
});

describe("printInfo", () => {
  afterEach(() => setOutputMode(false, false, false));

  test("outputs to stderr", () => {
    setOutputMode(false, false, false);
    const cap = captureConsole();
    try {
      printInfo("info message");
      expect(cap.errors[0]).toBe("info message");
    } finally {
      cap.restore();
    }
  });

  test("suppressed in quiet mode", () => {
    setOutputMode(false, false, true);
    const cap = captureConsole();
    try {
      printInfo("info message");
      expect(cap.errors.length).toBe(0);
    } finally {
      cap.restore();
    }
  });
});

describe("printVerbose", () => {
  afterEach(() => setOutputMode(false, false, false));

  test("outputs to stderr in verbose mode", () => {
    setOutputMode(false, true, false);
    const cap = captureConsole();
    try {
      printVerbose("debug detail");
      expect(cap.errors[0]).toBe("debug detail");
    } finally {
      cap.restore();
    }
  });

  test("suppressed when not verbose", () => {
    setOutputMode(false, false, false);
    const cap = captureConsole();
    try {
      printVerbose("debug detail");
      expect(cap.errors.length).toBe(0);
    } finally {
      cap.restore();
    }
  });
});

describe("printTable", () => {
  afterEach(() => setOutputMode(false, false, false));

  test("prints (no results) for empty rows", () => {
    const cap = captureConsole();
    try {
      printTable([], [{ key: "name", header: "Name" }]);
      expect(cap.logs[0]).toBe("(no results)");
    } finally {
      cap.restore();
    }
  });

  test("prints header, separator, and rows", () => {
    const cap = captureConsole();
    try {
      printTable(
        [
          { name: "Alice", age: 30 },
          { name: "Bob", age: 25 },
        ],
        [
          { key: "name", header: "Name", width: 10 },
          { key: "age", header: "Age", width: 5, align: "right" },
        ],
      );
      expect(cap.logs.length).toBe(4); // header + separator + 2 rows
      expect(cap.logs[0]).toContain("Name");
      expect(cap.logs[0]).toContain("Age");
      expect(cap.logs[1]).toContain("---");
      expect(cap.logs[2]).toContain("Alice");
      expect(cap.logs[3]).toContain("Bob");
    } finally {
      cap.restore();
    }
  });

  test("truncates long values", () => {
    const cap = captureConsole();
    try {
      printTable(
        [{ name: "A very long name that exceeds the width" }],
        [{ key: "name", header: "Name", width: 10 }],
      );
      // Row should be truncated to 10 chars (9 + ellipsis)
      const row = cap.logs[2];
      expect(row.trimEnd().length).toBeLessThanOrEqual(10);
    } finally {
      cap.restore();
    }
  });
});

describe("printSection", () => {
  test("prints title and key-value pairs", () => {
    const cap = captureConsole();
    try {
      printSection("Stats", [
        ["Total", 42],
        ["Active", 10],
      ]);
      expect(cap.logs[0]).toContain("Stats");
      expect(cap.logs[1]).toContain("-----");
      expect(cap.logs[2]).toContain("Total");
      expect(cap.logs[2]).toContain("42");
      expect(cap.logs[3]).toContain("Active");
      expect(cap.logs[3]).toContain("10");
    } finally {
      cap.restore();
    }
  });

  test("does not throw on empty entries", () => {
    const cap = captureConsole();
    try {
      expect(() => printSection("Empty", [])).not.toThrow();
      // Should produce no output (early return)
      expect(cap.logs.length).toBe(0);
    } finally {
      cap.restore();
    }
  });
});
