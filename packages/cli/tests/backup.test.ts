import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { SqliteAdapter, runGit } from "@reddit-saved/core";
import { setOutputMode } from "../src/output";
import { captureConsole, makeTempDb } from "./helpers";

const originalEnv = { ...process.env };

describe("backup commands", () => {
  let dbPath: string;
  let tempDir: string;
  let repoPath: string;

  beforeEach(() => {
    dbPath = makeTempDb();
    tempDir = dirname(dbPath);
    repoPath = join(tempDir, "backup-repo");
    setOutputMode(false, false, false);

    const configDir = join(tempDir, "config");
    mkdirSync(configDir, { recursive: true });
    process.env.REDDIT_SAVED_CONFIG_DIR = configDir;
    process.env.XDG_DATA_HOME = tempDir;
  });

  afterEach(() => {
    setOutputMode(false, false, false);
    for (const key of ["REDDIT_SAVED_CONFIG_DIR", "XDG_DATA_HOME"]) {
      if (originalEnv[key] !== undefined) {
        process.env[key] = originalEnv[key];
      } else {
        delete process.env[key];
      }
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("init, sync, and status round-trip through the configured repo", async () => {
    const seed = new SqliteAdapter(dbPath);
    seed.upsertPosts(
      [
        {
          kind: "t3",
          data: {
            id: "b1",
            name: "t3_b1",
            title: "Backup me",
            author: "a",
            subreddit: "s",
            permalink: "/r/s/comments/b1/post/",
            created_utc: 1_690_000_000,
            score: 1,
          },
        },
      ],
      "saved",
    );
    seed.close();

    const { backupInitCmd, backupSyncCmd, backupStatusCmd } = await import(
      "../src/commands/backup"
    );

    let cap = captureConsole();
    try {
      await backupInitCmd({ repo: repoPath }, []);
      expect(JSON.parse(cap.logs[0]).initialized).toBe(true);
    } finally {
      cap.restore();
    }

    await runGit(repoPath, ["config", "user.email", "test@example.com"]);
    await runGit(repoPath, ["config", "user.name", "Backup Test"]);

    cap = captureConsole();
    try {
      await backupSyncCmd({ db: dbPath }, []);
      const output = JSON.parse(cap.logs[0]);
      expect(output.committed).toBe(true);
      expect(output.written).toContain("data/posts/2023.jsonl");
    } finally {
      cap.restore();
    }
    expect(existsSync(join(repoPath, "manifest.json"))).toBe(true);
    expect(existsSync(join(repoPath, ".gitattributes"))).toBe(true);

    cap = captureConsole();
    try {
      await backupStatusCmd({ db: dbPath }, []);
      expect(JSON.parse(cap.logs[0]).upToDate).toBe(true);
    } finally {
      cap.restore();
    }

    // Second sync: nothing to write, nothing to commit
    cap = captureConsole();
    try {
      await backupSyncCmd({ db: dbPath }, []);
      const output = JSON.parse(cap.logs[0]);
      expect(output.written).toEqual([]);
      expect(output.committed).toBe(false);
    } finally {
      cap.restore();
    }
  });
});
