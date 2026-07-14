import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  INBOX_SYNC_DEFAULT_LIMIT,
  JOB_LOCK_STALE_MS,
  type JobStepResult,
  acquireJobLock,
  getJobLockPathForDatabase,
  loadConfig,
  paths,
  readJobLock,
  syncContext,
  syncInbox,
} from "@reddit-cached/core";
import { flagBool, flagInt, flagStr } from "../args";
import { type CliContext, createContext } from "../context";
import {
  DEFAULT_JOBS_INTERVAL_SECONDS,
  DEFAULT_JOBS_LABEL,
  buildJobsPlist,
  resolveJobsProgramArguments,
} from "../launchd";
import {
  clearProgress,
  isHumanMode,
  printError,
  printJson,
  printProgress,
  printSection,
  printTable,
  printWarning,
} from "../output";
import { DEFAULT_JOBS_UNIT_NAME, buildJobsServiceUnit, buildJobsTimerUnit } from "../systemd";
import { runBackupSync } from "./backup";
import { type OriginFetchResult, VALID_TYPES, runFetchForOrigin } from "./fetch";

/**
 * `jobs run` — the scheduled sync pipeline: fetch all origins → capture
 * thread context → sync the inbox → back up. Steps run sequentially; a
 * failing step is recorded but does not abort the rest. Guarded by a
 * cross-process file lock so overlapping launchd/manual runs skip cleanly.
 */

export const JOB_STEPS = ["fetch", "context", "inbox", "backup"] as const;
export type JobStep = (typeof JOB_STEPS)[number];

export function parseJobSteps(value: string | undefined): JobStep[] {
  if (!value) return [...JOB_STEPS];
  const requested = value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (requested.length === 0) return [...JOB_STEPS];
  for (const step of requested) {
    if (!JOB_STEPS.includes(step as JobStep)) {
      throw new Error(`Unknown job step "${step}". Valid steps: ${JOB_STEPS.join(", ")}`);
    }
  }
  // Preserve canonical pipeline order regardless of how they were listed.
  return JOB_STEPS.filter((s) => requested.includes(s));
}

export async function jobsRunCmd(
  flags: Record<string, string | boolean>,
  _positionals: string[],
): Promise<void> {
  const steps = parseJobSteps(flagStr(flags, "steps"));
  const limit = flagInt(flags, "limit");
  const trigger = flagStr(flags, "trigger") ?? "manual";
  const dbPath = flagStr(flags, "db");

  const lockPath = getJobLockPathForDatabase(dbPath ?? paths.database);
  const release = await acquireJobLock(lockPath);
  if (!release) {
    // Another run is in flight — skipping is the expected outcome for an
    // overlapping scheduled run, so it exits 0 and writes no provenance
    // (opening a second writer on the same DB mid-run invites SQLITE_BUSY).
    printJson({ skipped: true, reason: "already-running" });
    return;
  }

  try {
    // optionalAuth: an expired/missing session must not kill the run before
    // provenance is written — API steps fail per-step and the run records
    // "errored", which is what surfaces the breakage next time the app opens.
    const ctx = await createContext({ needsApi: true, optionalAuth: true, dbPath });
    try {
      const runId = ctx.storage.startJobRun(trigger);
      const results: JobStepResult[] = [];

      for (const step of steps) {
        const startedAt = Date.now();
        try {
          const result = await runJobStep(step, ctx, { limit, dbPath });
          results.push({ ...result, step, durationMs: Date.now() - startedAt });
        } catch (err) {
          results.push({
            step,
            ok: false,
            durationMs: Date.now() - startedAt,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        clearProgress();
      }

      const allOk = results.every((r) => r.ok);
      ctx.storage.finishJobRun(runId, { status: allOk ? "complete" : "errored", steps: results });

      if (!allOk) process.exitCode = 1;

      if (isHumanMode()) {
        for (const r of results) {
          printSection(`Step: ${r.step}`, [
            ["Status", r.ok ? (r.skipped ? `skipped (${r.skipped})` : "ok") : "FAILED"],
            ["Duration", `${Math.round(r.durationMs / 1000)}s`],
            ...(r.error ? [["Error", r.error] as [string, unknown]] : []),
          ]);
        }
        console.log();
      } else {
        printJson({ status: allOk ? "complete" : "errored", trigger, steps: results });
      }
    } finally {
      ctx.close();
    }
  } finally {
    await release();
  }
}

/** Execute one pipeline step. Returns everything except step/durationMs. */
async function runJobStep(
  step: JobStep,
  ctx: CliContext,
  opts: { limit?: number; dbPath?: string },
): Promise<Omit<JobStepResult, "step" | "durationMs">> {
  const api = ctx.apiClient as NonNullable<typeof ctx.apiClient>;

  // Backup is the only step that never talks to Reddit. The rest fail here
  // when no credentials exist, so the run records a clear per-step error
  // instead of burning API retries on a missing session.
  if (step !== "backup" && ctx.authAvailable === false) {
    throw new Error(
      "Not authenticated. Connect the browser extension or run 'reddit-cached auth login'.",
    );
  }

  switch (step) {
    case "fetch": {
      const results: OriginFetchResult[] = [];
      for (const typeStr of VALID_TYPES) {
        printProgress(`jobs: fetching ${typeStr}...`);
        try {
          results.push(
            await runFetchForOrigin(ctx, typeStr, {
              isFull: false,
              limit: opts.limit,
              dbPath: opts.dbPath,
            }),
          );
        } catch (err) {
          results.push({
            type: typeStr,
            status: "errored",
            fetched: 0,
            stored: 0,
            hasMore: false,
            duration: "0s",
            errored: true,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return { ok: results.every((r) => !r.errored), detail: results };
    }

    case "context": {
      printProgress("jobs: capturing thread context...");
      const result = await syncContext(ctx.storage, api, { limit: opts.limit });
      // Individual item failures retry next run by design — only a cancelled
      // run marks the step as failed.
      return { ok: !result.wasCancelled, detail: result };
    }

    case "inbox": {
      printProgress("jobs: syncing inbox...");
      const syncRunId = ctx.storage.startSyncRun("inbox", "incremental");
      try {
        const result = await syncInbox(ctx.storage, api, {
          limit: opts.limit ?? INBOX_SYNC_DEFAULT_LIMIT,
        });
        ctx.storage.finishSyncRun(syncRunId, {
          status: result.wasCancelled ? "cancelled" : "complete",
          fetched: result.fetched,
        });
        return { ok: !result.wasCancelled, detail: result };
      } catch (err) {
        ctx.storage.finishSyncRun(syncRunId, { status: "errored", fetched: 0 });
        throw err;
      }
    }

    case "backup": {
      const config = await loadConfig();
      if (!config.backup?.repoPath) {
        return { ok: true, skipped: "not-configured" };
      }
      printProgress("jobs: backing up...");
      const result = await runBackupSync(ctx, config.backup, {
        push: config.backup.push === true,
      });
      return { ok: true, detail: result };
    }
  }
}

function requireDarwin(): void {
  if (process.platform !== "darwin") {
    printError("launchd scheduling is only available on macOS.", "UNSUPPORTED_PLATFORM");
    process.exit(1);
  }
}

function plistPathForLabel(label: string): string {
  return join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
}

export async function jobsInstallLaunchdCmd(
  flags: Record<string, string | boolean>,
  _positionals: string[],
): Promise<void> {
  requireDarwin();

  const label = flagStr(flags, "label") ?? DEFAULT_JOBS_LABEL;
  const intervalSeconds = flagInt(flags, "interval-seconds") ?? DEFAULT_JOBS_INTERVAL_SECONDS;
  const steps = flagStr(flags, "steps") ? parseJobSteps(flagStr(flags, "steps")) : undefined;
  const load = !flagBool(flags, "no-load");

  const stdoutPath = join(paths.logs, "jobs.launchd.out.log");
  const stderrPath = join(paths.logs, "jobs.launchd.err.log");
  const programArguments = resolveJobsProgramArguments({
    execPath: process.execPath,
    mainPath: Bun.main,
    steps,
  });
  const plist = buildJobsPlist({
    label,
    intervalSeconds,
    programArguments,
    stdoutPath,
    stderrPath,
  });

  const plistPath = plistPathForLabel(label);
  await mkdir(paths.logs, { recursive: true });
  await mkdir(dirname(plistPath), { recursive: true });
  await writeFile(plistPath, plist);

  let loaded = false;
  if (load) {
    // Unload first so re-installing picks up the new plist; failure is normal
    // when the agent wasn't loaded yet.
    await Bun.spawn(["launchctl", "unload", plistPath], {
      stdout: "ignore",
      stderr: "ignore",
    }).exited;
    const loadProc = Bun.spawn(["launchctl", "load", "-w", plistPath], {
      stdout: "ignore",
      stderr: "pipe",
    });
    const code = await loadProc.exited;
    if (code !== 0) {
      const stderr = await new Response(loadProc.stderr).text();
      printError(`launchctl load failed (exit ${code}): ${stderr.trim()}`);
      process.exit(1);
    }
    loaded = true;
  }

  const output = {
    label,
    plistPath,
    loaded,
    intervalSeconds,
    programArguments,
    stdoutPath,
    stderrPath,
  };
  if (isHumanMode()) {
    printSection("launchd Agent Installed", [
      ["Label", label],
      ["Plist", plistPath],
      ["Interval", `${intervalSeconds}s`],
      ["Loaded", loaded ? "yes" : "no (--no-load)"],
      ["Logs", stdoutPath],
    ]);
    console.log();
  } else {
    printJson(output);
  }
}

export async function jobsUninstallLaunchdCmd(
  flags: Record<string, string | boolean>,
  _positionals: string[],
): Promise<void> {
  requireDarwin();

  const label = flagStr(flags, "label") ?? DEFAULT_JOBS_LABEL;
  const plistPath = plistPathForLabel(label);
  const existed = existsSync(plistPath);

  if (existed) {
    await Bun.spawn(["launchctl", "unload", plistPath], {
      stdout: "ignore",
      stderr: "ignore",
    }).exited;
    await rm(plistPath, { force: true });
  }

  const output = { label, plistPath, removed: existed };
  if (isHumanMode()) {
    printSection("launchd Agent Removed", [
      ["Label", label],
      ["Plist", existed ? "removed" : "was not installed"],
    ]);
    console.log();
  } else {
    printJson(output);
  }
}

function requireLinux(): void {
  if (process.platform !== "linux") {
    printError("systemd scheduling is only available on Linux.", "UNSUPPORTED_PLATFORM");
    process.exit(1);
  }
}

function systemdUnitPaths(unitName: string): { servicePath: string; timerPath: string } {
  const unitDir = join(homedir(), ".config", "systemd", "user");
  return {
    servicePath: join(unitDir, `${unitName}.service`),
    timerPath: join(unitDir, `${unitName}.timer`),
  };
}

/** Run a systemctl --user command, returning whether it succeeded. Failures
 *  are expected when the user has no systemd session (e.g. bare SSH). */
async function systemctlUser(args: string[]): Promise<boolean> {
  const proc = Bun.spawn(["systemctl", "--user", ...args], {
    stdout: "ignore",
    stderr: "pipe",
  });
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text();
    printWarning(`systemctl --user ${args.join(" ")} failed (exit ${code}): ${stderr.trim()}`);
    return false;
  }
  return true;
}

export async function jobsInstallSystemdCmd(
  flags: Record<string, string | boolean>,
  _positionals: string[],
): Promise<void> {
  requireLinux();

  const unitName = flagStr(flags, "unit-name") ?? DEFAULT_JOBS_UNIT_NAME;
  const intervalSeconds = flagInt(flags, "interval-seconds") ?? DEFAULT_JOBS_INTERVAL_SECONDS;
  const steps = flagStr(flags, "steps") ? parseJobSteps(flagStr(flags, "steps")) : undefined;
  const enable = !flagBool(flags, "no-enable");

  const execStart = resolveJobsProgramArguments({
    execPath: process.execPath,
    mainPath: Bun.main,
    steps,
    trigger: "systemd",
  });
  const service = buildJobsServiceUnit({
    description: "Reddit Cached jobs pipeline",
    execStartArguments: execStart,
  });
  const timer = buildJobsTimerUnit({
    description: "Run the Reddit Cached jobs pipeline periodically",
    intervalSeconds,
    unitName,
  });

  const { servicePath, timerPath } = systemdUnitPaths(unitName);
  await mkdir(dirname(servicePath), { recursive: true });
  await writeFile(servicePath, service);
  await writeFile(timerPath, timer);

  // stdout/stderr are captured by the journal — no log files to set up.
  const journalHint = `journalctl --user -u ${unitName}.service`;

  let enabled = false;
  if (enable) {
    // Failures are tolerated with a warning: the units are on disk either
    // way, and the user may lack a systemd user session right now.
    const reloaded = await systemctlUser(["daemon-reload"]);
    if (reloaded) {
      enabled = await systemctlUser(["enable", "--now", `${unitName}.timer`]);
    }
  }

  const output = {
    unitName,
    servicePath,
    timerPath,
    enabled,
    intervalSeconds,
    execStart,
    journalHint,
  };
  if (isHumanMode()) {
    printSection("systemd Timer Installed", [
      ["Unit", unitName],
      ["Service", servicePath],
      ["Timer", timerPath],
      ["Interval", `${intervalSeconds}s`],
      ["Enabled", enabled ? "yes" : "no"],
      ["Logs", journalHint],
    ]);
    console.log();
  } else {
    printJson(output);
  }
}

export async function jobsUninstallSystemdCmd(
  flags: Record<string, string | boolean>,
  _positionals: string[],
): Promise<void> {
  requireLinux();

  const unitName = flagStr(flags, "unit-name") ?? DEFAULT_JOBS_UNIT_NAME;
  const { servicePath, timerPath } = systemdUnitPaths(unitName);
  const existed = existsSync(servicePath) || existsSync(timerPath);

  // Ignore systemctl failures throughout — the goal is removing the files.
  await systemctlUser(["disable", "--now", `${unitName}.timer`]);
  await rm(servicePath, { force: true });
  await rm(timerPath, { force: true });
  await systemctlUser(["daemon-reload"]);

  const output = { unitName, servicePath, timerPath, removed: existed };
  if (isHumanMode()) {
    printSection("systemd Timer Removed", [
      ["Unit", unitName],
      ["Units", existed ? "removed" : "were not installed"],
    ]);
    console.log();
  } else {
    printJson(output);
  }
}

export async function jobsStatusCmd(
  flags: Record<string, string | boolean>,
  _positionals: string[],
): Promise<void> {
  const dbPath = flagStr(flags, "db");
  const limit = flagInt(flags, "limit") ?? 10;

  const ctx = await createContext({ dbPath });
  try {
    const runs = ctx.storage.getJobRunSummaries(limit);
    const lockPath = getJobLockPathForDatabase(dbPath ?? paths.database);
    const lock = await readJobLock(lockPath);

    const now = Date.now();
    const annotated = runs.map((run) => ({
      ...run,
      // Display-only: a run that never finished and is older than the lock's
      // stale window almost certainly crashed.
      crashed: run.finishedAt === null && now - run.startedAt > JOB_LOCK_STALE_MS,
    }));

    if (isHumanMode()) {
      printTable(
        annotated.map((run) => ({
          started: new Date(run.startedAt).toLocaleString(),
          status: run.crashed ? "crashed?" : run.status,
          trigger: run.trigger,
          steps: run.steps
            .map((s) => `${s.step}${s.ok ? "" : "!"}${s.skipped ? "~" : ""}`)
            .join(" "),
        })),
        [
          { key: "started", header: "Started" },
          { key: "status", header: "Status" },
          { key: "trigger", header: "Trigger" },
          { key: "steps", header: "Steps (! failed, ~ skipped)" },
        ],
      );
      console.log(`\nRunning now: ${lock ? `yes (pid ${lock.pid} on ${lock.host})` : "no"}`);
    } else {
      printJson({ runningNow: lock !== null, lock, runs: annotated });
    }
  } finally {
    ctx.close();
  }
}
