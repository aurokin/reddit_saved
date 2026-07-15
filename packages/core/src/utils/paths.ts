import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";

const APP_NAME = "reddit-cached";
const CUSTOM_CONFIG_DIR_ENV = "REDDIT_CACHED_CONFIG_DIR";

function getConfigDir(): string {
  const customConfigDir = process.env[CUSTOM_CONFIG_DIR_ENV];
  if (customConfigDir) {
    return customConfigDir;
  }
  const p = platform();
  if (p === "win32") {
    return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), APP_NAME);
  }
  if (p === "darwin") {
    return join(homedir(), "Library", "Application Support", APP_NAME);
  }
  // Linux / other — XDG
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdgConfig, APP_NAME);
}

function getDataDir(): string {
  const p = platform();
  if (p === "win32") {
    return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), APP_NAME);
  }
  if (p === "darwin") {
    return join(homedir(), "Library", "Application Support", APP_NAME);
  }
  // Linux / other — XDG
  const xdgData = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(xdgData, APP_NAME);
}

export const paths = {
  /** Directory for config files (auth.json, auth.lock) — re-evaluated on each access for testability */
  get config() {
    return getConfigDir();
  },
  /** Directory for data files (reddit-cached.db, checkpoint) — re-evaluated on each access for testability */
  get data() {
    return getDataDir();
  },

  /** Full path to auth credentials file */
  get authFile() {
    return join(getConfigDir(), "auth.json");
  },
  /** Full path to auth lock file */
  get authLock() {
    return join(getConfigDir(), "auth.lock");
  },
  /** Full path to session credentials file (cookies forwarded by the browser extension) */
  get sessionFile() {
    return join(getConfigDir(), "session.json");
  },
  /** Full path to the companion disconnect marker file. */
  get sessionBlockFile() {
    return join(getConfigDir(), "session.blocked.json");
  },
  /** Full path to SQLite database */
  get database() {
    return join(getDataDir(), "reddit-cached.db");
  },
  /** Full path to import checkpoint file */
  get checkpoint() {
    return join(getDataDir(), ".reddit-import-checkpoint.json");
  },
  /** Directory for log files (launchd job stdout/stderr) */
  get logs() {
    return join(getDataDir(), "logs");
  },
};

/** Database path resolution shared by every surface (CLI, web, jobs):
 *  explicit override (the `--db` flag) > `REDDIT_CACHED_DB` env var >
 *  platform default. The env var is re-read on each call for testability,
 *  matching `paths` above. */
export function resolveDatabasePath(override?: string): string {
  if (override) return override;
  const envPath = process.env.REDDIT_CACHED_DB;
  if (envPath) return resolve(envPath);
  return paths.database;
}

/** Checkpoint file co-located with the database. With an origin, each sync
 *  origin gets its own file so concurrent/interleaved origin syncs can't
 *  clobber each other's resume state. The origin-less form is the legacy
 *  single-file location, kept for one-time adoption. */
export function getCheckpointPathForDatabase(dbPath: string, origin?: string): string {
  const suffix = origin ? `.${origin}` : "";
  return join(dirname(dbPath), `.reddit-import-checkpoint${suffix}.json`);
}

/** Job lock file co-located with the database, mirroring the checkpoint
 *  convention — `--db` runs get their own lock, tests stay hermetic. */
export function getJobLockPathForDatabase(dbPath: string): string {
  return join(dirname(dbPath), ".reddit-jobs.lock");
}
