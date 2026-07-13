import { describe, expect, test } from "bun:test";
import {
  DEFAULT_JOBS_INTERVAL_SECONDS,
  DEFAULT_JOBS_LABEL,
  buildJobsPlist,
  resolveJobsProgramArguments,
} from "../src/launchd";

describe("resolveJobsProgramArguments", () => {
  const cases: Array<{
    name: string;
    execPath: string;
    mainPath: string;
    steps?: string[];
    expected: string[];
  }> = [
    {
      name: "bun running a .ts entry keeps the script path",
      execPath: "/opt/homebrew/bin/bun",
      mainPath: "/repo/packages/cli/src/index.ts",
      expected: [
        "/opt/homebrew/bin/bun",
        "/repo/packages/cli/src/index.ts",
        "jobs",
        "run",
        "--trigger",
        "launchd",
      ],
    },
    {
      name: "bun running a .js entry keeps the script path",
      execPath: "/usr/local/bin/bun",
      mainPath: "/dist/index.js",
      expected: ["/usr/local/bin/bun", "/dist/index.js", "jobs", "run", "--trigger", "launchd"],
    },
    {
      name: "compiled binary drops the main path",
      execPath: "/usr/local/bin/reddit-cached",
      mainPath: "/$bunfs/root/reddit-cached",
      expected: ["/usr/local/bin/reddit-cached", "jobs", "run", "--trigger", "launchd"],
    },
    {
      name: "steps are appended as a comma list",
      execPath: "/opt/homebrew/bin/bun",
      mainPath: "/repo/index.ts",
      steps: ["fetch", "inbox"],
      expected: [
        "/opt/homebrew/bin/bun",
        "/repo/index.ts",
        "jobs",
        "run",
        "--trigger",
        "launchd",
        "--steps",
        "fetch,inbox",
      ],
    },
  ];

  for (const c of cases) {
    test(c.name, () => {
      expect(
        resolveJobsProgramArguments({
          execPath: c.execPath,
          mainPath: c.mainPath,
          steps: c.steps,
        }),
      ).toEqual(c.expected);
    });
  }
});

describe("buildJobsPlist", () => {
  const base = {
    label: DEFAULT_JOBS_LABEL,
    intervalSeconds: DEFAULT_JOBS_INTERVAL_SECONDS,
    programArguments: ["/bin/bun", "/repo/index.ts", "jobs", "run"],
    stdoutPath: "/logs/out.log",
    stderrPath: "/logs/err.log",
  };

  test("contains the launchd keys with the right values", () => {
    const plist = buildJobsPlist(base);
    expect(plist).toContain("<key>Label</key>");
    expect(plist).toContain(`<string>${DEFAULT_JOBS_LABEL}</string>`);
    expect(plist).toContain("<key>StartInterval</key>");
    expect(plist).toContain("<integer>3600</integer>");
    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toContain("<true/>");
    expect(plist).toContain("<string>/logs/out.log</string>");
    expect(plist).toContain("<string>/logs/err.log</string>");
    expect(plist).toContain("<key>PATH</key>");
    expect(plist).not.toContain("KeepAlive");
  });

  test("preserves ProgramArguments order", () => {
    const plist = buildJobsPlist(base);
    const argsSection = plist.slice(plist.indexOf("<array>"), plist.indexOf("</array>"));
    const strings = [...argsSection.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]);
    expect(strings).toEqual(["/bin/bun", "/repo/index.ts", "jobs", "run"]);
  });

  test("xml-escapes special characters in paths and labels", () => {
    const plist = buildJobsPlist({
      ...base,
      label: "a&b<c>",
      stdoutPath: '/logs/"quoted" & <odd>.log',
    });
    expect(plist).toContain("<string>a&amp;b&lt;c&gt;</string>");
    expect(plist).toContain("<string>/logs/&quot;quoted&quot; &amp; &lt;odd&gt;.log</string>");
    expect(plist).not.toMatch(/<string>[^<]*&(?!amp;|lt;|gt;|quot;)[^<]*<\/string>/);
  });

  test("clamps the interval to at least 60 seconds", () => {
    expect(buildJobsPlist({ ...base, intervalSeconds: 5 })).toContain("<integer>60</integer>");
  });
});
