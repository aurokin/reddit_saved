import { homedir, platform } from "node:os";
import { join } from "node:path";

const APP_NAME = "reddit-saved";

function getConfigDir(): string {
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
  /** Directory for data files (reddit-saved.db, checkpoint) — re-evaluated on each access for testability */
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
  /** Full path to SQLite database */
  get database() {
    return join(getDataDir(), "reddit-saved.db");
  },
  /** Full path to import checkpoint file */
  get checkpoint() {
    return join(getDataDir(), ".reddit-import-checkpoint.json");
  },
};
