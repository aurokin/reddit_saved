import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  type BackupConfig,
  backupStatus,
  commitBackup,
  ensureGitRepo,
  loadConfig,
  saveConfig,
  writeBackup,
  writeRepoScaffolding,
} from "@reddit-saved/core";
import { flagBool, flagStr } from "../args";
import { createContext } from "../context";
import { isHumanMode, printError, printJson, printSection } from "../output";

async function requireBackupConfig(flags: Record<string, string | boolean>): Promise<BackupConfig> {
  const repoOverride = flagStr(flags, "repo");
  if (repoOverride) return { repoPath: resolve(repoOverride) };

  const config = await loadConfig();
  if (!config.backup?.repoPath) {
    printError(
      "No backup repository configured. Run 'reddit-saved backup init --repo <path>' first.",
      "BACKUP_NOT_CONFIGURED",
    );
    process.exit(1);
  }
  return config.backup;
}

export async function backupInitCmd(
  flags: Record<string, string | boolean>,
  _positionals: string[],
): Promise<void> {
  const repoFlag = flagStr(flags, "repo");
  if (!repoFlag) {
    printError("Usage: reddit-saved backup init --repo <path> [--remote <name>] [--push]");
    process.exit(1);
  }
  const repoPath = resolve(repoFlag);
  const remote = flagStr(flags, "remote");
  const push = flagBool(flags, "push");

  mkdirSync(repoPath, { recursive: true });
  const { initialized } = await ensureGitRepo(repoPath);
  await writeRepoScaffolding(repoPath);

  const config = await loadConfig();
  config.backup = { repoPath, ...(remote ? { remote } : {}), ...(push ? { push: true } : {}) };
  await saveConfig(config);

  const output = { repoPath, initialized, remote: remote ?? null, push };
  if (isHumanMode()) {
    printSection("Backup Configured", [
      ["Repository", repoPath],
      ["Git repo", initialized ? "initialized" : "already present"],
      ...(remote ? [["Remote", remote] as [string, unknown]] : []),
      ["Push by default", push ? "yes" : "no"],
      ["Next step", "run 'reddit-saved backup sync'"],
    ]);
    console.log();
  } else {
    printJson(output);
  }
}

export async function backupSyncCmd(
  flags: Record<string, string | boolean>,
  _positionals: string[],
): Promise<void> {
  const backup = await requireBackupConfig(flags);
  const skipGit = flagBool(flags, "no-git");
  const push = flagBool(flags, "push") || backup.push === true;

  const ctx = await createContext({ dbPath: flagStr(flags, "db") });
  try {
    const result = await writeBackup(ctx.storage, backup.repoPath);

    let git = { pulled: false, committed: false, pushed: false };
    if (!skipGit) {
      const stats = ctx.storage.getStats();
      const total = stats.totalPosts + stats.totalComments + stats.contextCount;
      git = await commitBackup(backup.repoPath, {
        message: `backup: ${total} items (${result.manifest.backupHash.slice(0, 12)})`,
        remote: backup.remote,
        push,
      });
    }

    const output = {
      repoPath: backup.repoPath,
      backupHash: result.manifest.backupHash,
      written: result.written,
      removed: result.removed,
      unchangedFiles: result.unchanged.length,
      ...git,
    };

    if (isHumanMode()) {
      printSection("Backup Sync", [
        ["Repository", backup.repoPath],
        ["Files written", result.written.length],
        ["Files unchanged", result.unchanged.length],
        ...(result.removed.length > 0
          ? [["Files removed", result.removed.length] as [string, unknown]]
          : []),
        ["Committed", skipGit ? "skipped (--no-git)" : git.committed ? "yes" : "no changes"],
        ...(push && !skipGit ? [["Pushed", git.pushed ? "yes" : "no"] as [string, unknown]] : []),
        ["Backup hash", result.manifest.backupHash.slice(0, 12)],
      ]);
      console.log();
    } else {
      printJson(output);
    }
  } finally {
    ctx.close();
  }
}

export async function backupStatusCmd(
  flags: Record<string, string | boolean>,
  _positionals: string[],
): Promise<void> {
  const backup = await requireBackupConfig(flags);

  const ctx = await createContext({ dbPath: flagStr(flags, "db") });
  try {
    const status = await backupStatus(ctx.storage, backup.repoPath);

    const output = {
      repoPath: status.repoPath,
      upToDate: status.upToDate,
      lastBackupHash: status.repoManifest?.backupHash ?? null,
      currentHash: status.currentManifest.backupHash,
      pendingChanges: status.pendingChanges,
      totalRows: status.currentManifest.files.reduce((sum, f) => sum + f.rows, 0),
    };

    if (isHumanMode()) {
      printSection("Backup Status", [
        ["Repository", status.repoPath],
        ["Up to date", status.upToDate ? "yes" : "no"],
        ["Rows to back up", output.totalRows],
        ...(status.upToDate
          ? []
          : ([["Pending changes", status.pendingChanges.join(", ") || "(first backup)"]] as Array<
              [string, unknown]
            >)),
      ]);
      console.log();
    } else {
      printJson(output);
    }
  } finally {
    ctx.close();
  }
}
