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
} from "@reddit-cached/core";
import { flagBool, flagStr } from "../args";
import { type CliContext, createContext } from "../context";
import { isHumanMode, printError, printJson, printSection } from "../output";

async function requireBackupConfig(flags: Record<string, string | boolean>): Promise<BackupConfig> {
  const repoOverride = flagStr(flags, "repo");
  if (repoOverride) return { repoPath: resolve(repoOverride) };

  const config = await loadConfig();
  if (!config.backup?.repoPath) {
    printError(
      "No backup repository configured. Run 'reddit-cached backup init --repo <path>' first.",
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
    printError("Usage: reddit-cached backup init --repo <path> [--remote <name>] [--push]");
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
      ["Next step", "run 'reddit-cached backup sync'"],
    ]);
    console.log();
  } else {
    printJson(output);
  }
}

export interface BackupSyncOutput {
  repoPath: string;
  backupHash: string;
  written: string[];
  removed: string[];
  unchangedFiles: number;
  pulled: boolean;
  committed: boolean;
  pushed: boolean;
}

/** Write the backup and (unless skipGit) commit/push it. Shared by the
 *  backup sync command and the jobs pipeline's backup step. */
export async function runBackupSync(
  ctx: CliContext,
  backup: BackupConfig,
  opts: { push: boolean; skipGit?: boolean },
): Promise<BackupSyncOutput> {
  const result = await writeBackup(ctx.storage, backup.repoPath);

  let git = { pulled: false, committed: false, pushed: false };
  if (!opts.skipGit) {
    const stats = ctx.storage.getStats();
    const total = stats.totalPosts + stats.totalComments + stats.contextCount;
    git = await commitBackup(backup.repoPath, {
      message: `backup: ${total} items (${result.manifest.backupHash.slice(0, 12)})`,
      remote: backup.remote,
      push: opts.push,
    });
  }

  return {
    repoPath: backup.repoPath,
    backupHash: result.manifest.backupHash,
    written: result.written,
    removed: result.removed,
    unchangedFiles: result.unchanged.length,
    ...git,
  };
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
    const output = await runBackupSync(ctx, backup, { push, skipGit });

    if (isHumanMode()) {
      printSection("Backup Sync", [
        ["Repository", backup.repoPath],
        ["Files written", output.written.length],
        ["Files unchanged", output.unchangedFiles],
        ...(output.removed.length > 0
          ? [["Files removed", output.removed.length] as [string, unknown]]
          : []),
        ["Committed", skipGit ? "skipped (--no-git)" : output.committed ? "yes" : "no changes"],
        ...(push && !skipGit
          ? [["Pushed", output.pushed ? "yes" : "no"] as [string, unknown]]
          : []),
        ["Backup hash", output.backupHash.slice(0, 12)],
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
