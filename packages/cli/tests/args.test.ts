import { describe, expect, test } from "bun:test";
import { flagBool, flagInt, flagStr, mapTypeFlag, parseArgs, parseDateFlag } from "../src/args";

describe("parseArgs", () => {
  test("parses a simple command", () => {
    const result = parseArgs(["fetch"]);
    expect(result.command).toEqual(["fetch"]);
    expect(result.flags).toEqual({});
    expect(result.positionals).toEqual([]);
  });

  test("parses nested subcommand", () => {
    const result = parseArgs(["auth", "login"]);
    expect(result.command).toEqual(["auth", "login"]);
  });

  test("parses tag subcommands", () => {
    const result = parseArgs(["tag", "create", "my-tag"]);
    expect(result.command).toEqual(["tag", "create"]);
    expect(result.positionals).toEqual(["my-tag"]);
  });

  test("parses --flag value", () => {
    const result = parseArgs(["fetch", "--type", "saved"]);
    expect(result.command).toEqual(["fetch"]);
    expect(result.flags).toEqual({ type: "saved" });
  });

  test("parses --flag=value", () => {
    const result = parseArgs(["fetch", "--type=saved"]);
    expect(result.flags).toEqual({ type: "saved" });
  });

  test("parses boolean flags", () => {
    const result = parseArgs(["fetch", "--full"]);
    expect(result.flags).toEqual({ full: true });
  });

  test("boolean flag when next arg is also a flag", () => {
    const result = parseArgs(["fetch", "--full", "--type", "saved"]);
    expect(result.flags).toEqual({ full: true, type: "saved" });
  });

  test("parses short aliases", () => {
    const result = parseArgs(["-H", "-v", "fetch"]);
    expect(result.flags).toEqual({ human: true, verbose: true });
    expect(result.command).toEqual(["fetch"]);
  });

  test("-- stops flag parsing", () => {
    const result = parseArgs(["search", "--", "--literal-query"]);
    expect(result.command).toEqual(["search"]);
    expect(result.positionals).toEqual(["--literal-query"]);
    expect(result.flags).toEqual({});
  });

  test("positionals after command", () => {
    const result = parseArgs(["search", "rust programming"]);
    expect(result.command).toEqual(["search"]);
    expect(result.positionals).toEqual(["rust programming"]);
  });

  test("tag add with --to flag and multiple IDs", () => {
    const result = parseArgs(["tag", "add", "ml", "--to", "abc123", "def456"]);
    expect(result.command).toEqual(["tag", "add"]);
    expect(result.positionals).toEqual(["ml", "def456"]);
    expect(result.flags).toEqual({ to: "abc123" });
  });

  test("no command yields empty command array", () => {
    const result = parseArgs(["--help"]);
    expect(result.command).toEqual([]);
    expect(result.flags).toEqual({ help: true });
  });

  test("unknown short flag passes through", () => {
    const result = parseArgs(["-x"]);
    expect(result.flags).toEqual({ x: true });
  });

  test("mixed flags and positionals", () => {
    const result = parseArgs([
      "search",
      "query",
      "--subreddit",
      "rust",
      "--limit",
      "10",
      "--human",
    ]);
    expect(result.command).toEqual(["search"]);
    expect(result.positionals).toEqual(["query"]);
    expect(result.flags).toEqual({ subreddit: "rust", limit: "10", human: true });
  });

  test("empty argv", () => {
    const result = parseArgs([]);
    expect(result.command).toEqual([]);
    expect(result.flags).toEqual({});
    expect(result.positionals).toEqual([]);
  });

  test("-q short alias for quiet", () => {
    const result = parseArgs(["-q", "fetch"]);
    expect(result.flags).toEqual({ quiet: true });
    expect(result.command).toEqual(["fetch"]);
  });

  test("boolean flag --confirm does not consume next arg", () => {
    const result = parseArgs(["unsave", "--confirm", "--subreddit", "test"]);
    expect(result.flags.confirm).toBe(true);
    expect(result.flags.subreddit).toBe("test");
  });

  test("boolean flag --full does not consume next arg", () => {
    const result = parseArgs(["fetch", "--full", "--type", "saved"]);
    expect(result.flags.full).toBe(true);
    expect(result.flags.type).toBe("saved");
  });

  test("boolean flag --dry-run does not consume next positional", () => {
    const result = parseArgs(["unsave", "--dry-run", "--confirm", "--id", "abc123"]);
    expect(result.flags["dry-run"]).toBe(true);
    expect(result.flags.confirm).toBe(true);
    expect(result.flags.id).toBe("abc123");
  });

  test("boolean flag --orphaned does not consume next arg", () => {
    const result = parseArgs(["list", "--orphaned", "--limit", "10"]);
    expect(result.flags.orphaned).toBe(true);
    expect(result.flags.limit).toBe("10");
  });

  test("all global boolean short aliases", () => {
    const result = parseArgs(["-H", "-v", "-q", "status"]);
    expect(result.flags).toEqual({ human: true, verbose: true, quiet: true });
    expect(result.command).toEqual(["status"]);
  });

  test("--include-raw is parsed as boolean flag", () => {
    const result = parseArgs(["export", "--include-raw", "--format", "json"]);
    expect(result.flags["include-raw"]).toBe(true);
    expect(result.flags.format).toBe("json");
  });
});

describe("flagStr", () => {
  test("returns string value", () => {
    expect(flagStr({ name: "value" }, "name")).toBe("value");
  });

  test("returns undefined for boolean flag", () => {
    expect(flagStr({ name: true }, "name")).toBeUndefined();
  });

  test("returns undefined for missing flag", () => {
    expect(flagStr({}, "name")).toBeUndefined();
  });
});

describe("flagInt", () => {
  test("parses integer value", () => {
    expect(flagInt({ limit: "10" }, "limit")).toBe(10);
  });

  test("returns undefined for missing flag", () => {
    expect(flagInt({}, "limit")).toBeUndefined();
  });

  test("throws on non-integer", () => {
    expect(() => flagInt({ limit: "abc" }, "limit")).toThrow("must be an integer");
  });
});

describe("flagBool", () => {
  test("returns true for set boolean flag", () => {
    expect(flagBool({ full: true }, "full")).toBe(true);
  });

  test("returns false for missing flag", () => {
    expect(flagBool({}, "full")).toBe(false);
  });

  test("returns false for string value flag", () => {
    expect(flagBool({ full: "yes" }, "full")).toBe(false);
  });
});

describe("negative number flag values", () => {
  test("--min-score -5 is parsed as value, not flag", () => {
    const result = parseArgs(["list", "--min-score", "-5"]);
    expect(result.flags["min-score"]).toBe("-5");
    expect(flagInt(result.flags, "min-score")).toBe(-5);
  });

  test("--offset -10 is parsed as value", () => {
    const result = parseArgs(["list", "--offset", "-10"]);
    expect(result.flags.offset).toBe("-10");
  });

  test("negative number after non-boolean flag is consumed", () => {
    const result = parseArgs(["search", "query", "--limit", "-1"]);
    expect(result.flags.limit).toBe("-1");
  });
});

describe("boolean flag with = syntax", () => {
  test("--confirm=yes is truthy", () => {
    const result = parseArgs(["unsave", "--confirm=yes"]);
    expect(result.flags.confirm).toBe(true);
    expect(flagBool(result.flags, "confirm")).toBe(true);
  });

  test("--confirm=true is truthy", () => {
    const result = parseArgs(["unsave", "--confirm=true"]);
    expect(flagBool(result.flags, "confirm")).toBe(true);
  });

  test("--confirm=false is falsy", () => {
    const result = parseArgs(["unsave", "--confirm=false"]);
    expect(flagBool(result.flags, "confirm")).toBe(false);
  });

  test("--confirm=0 is falsy", () => {
    const result = parseArgs(["unsave", "--confirm=0"]);
    expect(flagBool(result.flags, "confirm")).toBe(false);
  });

  test("--full=false is falsy", () => {
    const result = parseArgs(["fetch", "--full=false"]);
    expect(flagBool(result.flags, "full")).toBe(false);
  });
});

describe("mapTypeFlag", () => {
  test("maps 'post' to 't3'", () => {
    expect(mapTypeFlag("post")).toBe("t3");
  });

  test("maps 'comment' to 't1'", () => {
    expect(mapTypeFlag("comment")).toBe("t1");
  });

  test("returns undefined for undefined input", () => {
    expect(mapTypeFlag(undefined)).toBeUndefined();
  });

  test("throws on unrecognized value", () => {
    expect(() => mapTypeFlag("thread")).toThrow("Invalid --type");
  });

  test("throws on empty string", () => {
    expect(() => mapTypeFlag("")).toThrow("Invalid --type");
  });
});

describe("parseDateFlag", () => {
  test("parses YYYY-MM-DD start boundary as UTC midnight", () => {
    expect(parseDateFlag("2024-01-15", "after", "start")).toBe(1705276800);
  });

  test("parses YYYY-MM-DD end boundary as end of UTC day", () => {
    expect(parseDateFlag("2024-01-15", "before", "end")).toBe(1705363199);
  });

  test("parses ISO timestamps", () => {
    expect(parseDateFlag("2024-01-15T12:34:56Z", "after", "start")).toBe(1705322096);
  });

  test("returns undefined for missing value", () => {
    expect(parseDateFlag(undefined, "after", "start")).toBeUndefined();
  });

  test("throws on invalid date strings", () => {
    expect(() => parseDateFlag("not-a-date", "after", "start")).toThrow("Invalid --after");
  });
});
