import { join } from "node:path";

/**
 * Minimal git plumbing for the backup repo, via Bun.spawn.
 * Never touches any repository other than the configured backup repo.
 */

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function runGit(repoPath: string, args: string[]): Promise<GitResult> {
  const proc = Bun.spawn(["git", "-C", repoPath, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout: stdout.trim(), stderr: stderr.trim() };
}

async function gitOrThrow(repoPath: string, args: string[]): Promise<GitResult> {
  const result = await runGit(repoPath, args);
  if (result.code !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (${result.code}): ${result.stderr || result.stdout}`,
    );
  }
  return result;
}

export async function isGitRepo(repoPath: string): Promise<boolean> {
  return (await runGit(repoPath, ["rev-parse", "--is-inside-work-tree"])).code === 0;
}

/** Initialize repoPath as a git repository if it isn't one already. */
export async function ensureGitRepo(repoPath: string): Promise<{ initialized: boolean }> {
  if (await isGitRepo(repoPath)) return { initialized: false };
  await gitOrThrow(repoPath, ["init"]);
  return { initialized: true };
}

export async function hasRemote(repoPath: string, remote: string): Promise<boolean> {
  const result = await runGit(repoPath, ["remote"]);
  return (
    result.code === 0 &&
    result.stdout
      .split("\n")
      .map((line) => line.trim())
      .includes(remote)
  );
}

export interface BackupCommitOptions {
  message: string;
  /** Remote to pull from / push to (only used when configured) */
  remote?: string;
  push?: boolean;
}

export interface BackupCommitResult {
  pulled: boolean;
  committed: boolean;
  pushed: boolean;
}

/** pull --ff-only (when a remote is set) → add -A → commit only if something
 *  is staged → optional push. GPG signing is disabled for the backup commit
 *  so an interactive pinentry can never wedge an unattended sync. */
export async function commitBackup(
  repoPath: string,
  opts: BackupCommitOptions,
): Promise<BackupCommitResult> {
  const result: BackupCommitResult = { pulled: false, committed: false, pushed: false };

  const remoteUsable = opts.remote ? await hasRemote(repoPath, opts.remote) : false;
  if (opts.remote && !remoteUsable) {
    throw new Error(`Configured git remote "${opts.remote}" does not exist in ${repoPath}`);
  }

  if (remoteUsable && opts.remote) {
    // A brand-new remote branch may not exist yet — tolerate pull failures
    // from "no upstream", but surface real divergence errors.
    const pull = await runGit(repoPath, ["pull", "--ff-only", opts.remote]);
    if (pull.code === 0) {
      result.pulled = true;
    } else if (
      !/no tracking information|couldn't find remote ref|does not appear/i.test(pull.stderr)
    ) {
      throw new Error(`git pull --ff-only failed: ${pull.stderr || pull.stdout}`);
    }
  }

  await gitOrThrow(repoPath, ["add", "-A"]);

  const staged = await runGit(repoPath, ["diff", "--cached", "--quiet"]);
  if (staged.code !== 0) {
    await gitOrThrow(repoPath, ["-c", "commit.gpgsign=false", "commit", "-m", opts.message]);
    result.committed = true;
  }

  if (opts.push && remoteUsable && opts.remote && result.committed) {
    const branch = (await gitOrThrow(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout;
    await gitOrThrow(repoPath, ["push", "-u", opts.remote, branch]);
    result.pushed = true;
  }

  return result;
}

/** Files every backup repo should carry, written once by `backup init`. */
export async function writeRepoScaffolding(repoPath: string): Promise<void> {
  const gitattributes = join(repoPath, ".gitattributes");
  if (!(await Bun.file(gitattributes).exists())) {
    await Bun.write(gitattributes, "* text eol=lf\n");
  }
}
