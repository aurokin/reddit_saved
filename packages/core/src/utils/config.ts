import { mkdirSync } from "node:fs";
import { rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { paths } from "./paths";

/**
 * General app configuration — <configDir>/config.json.
 * Currently only the backup destination lives here; other settings files
 * (auth.json, session.json) predate this and stay separate.
 */

export interface BackupConfig {
  /** Absolute path to the git repository that receives JSONL backups */
  repoPath: string;
  /** Optional git remote name to push to (e.g. "origin") */
  remote?: string;
  /** Push after each backup commit by default */
  push?: boolean;
}

export interface AppConfig {
  backup?: BackupConfig;
}

export function getConfigFilePath(): string {
  return join(paths.config, "config.json");
}

/** Load config.json; a missing file is an empty config. Corrupt JSON throws —
 *  silently ignoring it could make a backup land in the wrong repository. */
export async function loadConfig(): Promise<AppConfig> {
  const file = Bun.file(getConfigFilePath());
  if (!(await file.exists())) return {};
  const parsed = (await file.json()) as AppConfig;
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`Invalid config file at ${getConfigFilePath()}`);
  }
  return parsed;
}

/** Atomically write config.json (write .tmp then rename). */
export async function saveConfig(config: AppConfig): Promise<void> {
  const path = getConfigFilePath();
  mkdirSync(paths.config, { recursive: true });
  const tmp = `${path}.tmp`;
  try {
    await Bun.write(tmp, `${JSON.stringify(config, null, 2)}\n`);
    await rename(tmp, path);
  } catch (err) {
    try {
      await unlink(tmp);
    } catch {
      /* best-effort cleanup */
    }
    throw err;
  }
}
