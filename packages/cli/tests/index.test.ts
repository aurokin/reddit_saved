import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SqliteAdapter } from "@reddit-saved/core";
import { makeItem, makeTempDb } from "./helpers";

const CLI_PATH = join(import.meta.dir, "../src/index.ts");

describe("CLI entry point", () => {
  test("--version prints version number", async () => {
    const proc = Bun.spawn(["bun", "run", CLI_PATH, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    expect(proc.exitCode).toBe(0);
    expect(output.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("--help prints usage text", async () => {
    const proc = Bun.spawn(["bun", "run", CLI_PATH, "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    expect(proc.exitCode).toBe(0);
    expect(output).toContain("reddit-saved");
    expect(output).toContain("Commands:");
    expect(output).toContain("auth login");
    expect(output).toContain("tag create");
  });

  test("no command prints usage text", async () => {
    const proc = Bun.spawn(["bun", "run", CLI_PATH], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    expect(proc.exitCode).toBe(0);
    expect(output).toContain("Usage:");
  });

  test("unknown command exits with error", async () => {
    // "auth" alone (without login/status/logout) maps to no handler
    const proc = Bun.spawn(["bun", "run", CLI_PATH, "auth"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;
    expect(proc.exitCode).toBe(1);
    expect(stderr).toContain("Unknown command");
  });

  test("dispatches status command with --db", async () => {
    const dbPath = makeTempDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.upsertPosts([makeItem({ id: "p1" }), makeItem({ id: "p2" })], "saved");
    adapter.close();

    const proc = Bun.spawn(["bun", "run", CLI_PATH, "status", "--db", dbPath], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    await proc.exited;

    rmSync(dirname(dbPath), { recursive: true, force: true });

    expect(proc.exitCode).toBe(0);
    const json = JSON.parse(output);
    expect(json.totalPosts).toBe(2);
  });

  test("auth status respects --config override", async () => {
    const configDir = join(
      tmpdir(),
      `cli-index-config-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "auth.json"),
      JSON.stringify({
        accessToken: "test-token",
        refreshToken: "test-refresh",
        tokenExpiry: Date.now() + 3600_000,
        username: "config-user",
        clientId: "test-client-id",
      }),
    );

    const proc = Bun.spawn(["bun", "run", CLI_PATH, "auth", "status", "--config", configDir], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    await proc.exited;

    rmSync(configDir, { recursive: true, force: true });

    expect(proc.exitCode).toBe(0);
    const json = JSON.parse(output);
    expect(json.authenticated).toBe(true);
    expect(json.username).toBe("config-user");
  });
});
