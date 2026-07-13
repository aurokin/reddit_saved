import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COMMANDS } from "../src/commands/registry";

/**
 * Drift guard: every `reddit-saved <command>` mentioned in the agent skill
 * must exist in the CLI command registry. If a command is renamed or removed,
 * this test forces the SKILL.md to be updated with it.
 */

const SKILL_PATH = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  ".agents",
  "skills",
  "reddit-saved",
  "SKILL.md",
);

function extractSkillCommands(markdown: string): string[] {
  // Commands appear in inline code spans (`reddit-saved search "<q>"`) and in
  // fenced code block lines (reddit-saved status). Prose is not scanned.
  const invocations: string[] = [];
  for (const match of markdown.matchAll(/`reddit-saved ([^`]+)`/g)) {
    invocations.push(match[1]);
  }
  for (const block of markdown.matchAll(/```bash\n([\s\S]*?)```/g)) {
    for (const line of block[1].split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("reddit-saved ")) {
        invocations.push(trimmed.slice("reddit-saved ".length));
      }
    }
  }

  const WORD = /^[a-z][a-z-]*$/;
  const found = new Set<string>();
  for (const invocation of invocations) {
    const [first, second] = invocation.split(/\s+/);
    if (!first || !WORD.test(first)) continue;
    if (second && WORD.test(second) && COMMANDS[`${first} ${second}`]) {
      found.add(`${first} ${second}`);
    } else {
      found.add(first);
    }
  }
  return [...found].sort();
}

describe("SKILL.md drift guard", () => {
  const markdown = readFileSync(SKILL_PATH, "utf8");
  const commands = extractSkillCommands(markdown);

  test("skill references at least the core commands", () => {
    for (const expected of ["search", "list", "research", "status", "fetch context"]) {
      expect(commands).toContain(expected);
    }
  });

  test("every command referenced in SKILL.md exists in the CLI registry", () => {
    const missing = commands.filter((cmd) => !COMMANDS[cmd]);
    expect(missing).toEqual([]);
  });
});
