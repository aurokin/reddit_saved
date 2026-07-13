/**
 * launchd plist generation for the jobs pipeline (macOS). Pure functions —
 * the install command handles filesystem and launchctl side effects.
 *
 * Model (ported from birdclaw): periodic one-shots via StartInterval +
 * RunAtLoad; no KeepAlive. PATH is baked in because launchd agents don't
 * source a shell profile and the backup step needs git.
 */

export const DEFAULT_JOBS_LABEL = "com.reddit-saved.jobs";
export const DEFAULT_JOBS_INTERVAL_SECONDS = 3600;

const LAUNCHD_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

/** Argv for running `jobs run` under launchd. When the CLI runs as a script
 *  (`bun src/index.ts`), mainPath is that script and execPath is the bun
 *  binary; a compiled single-file binary IS the CLI, so mainPath is dropped. */
export function resolveJobsProgramArguments(opts: {
  execPath: string;
  mainPath: string;
  steps?: string[];
}): string[] {
  const isScript = /\.(ts|js|mjs|cjs)$/.test(opts.mainPath);
  return [
    opts.execPath,
    ...(isScript ? [opts.mainPath] : []),
    "jobs",
    "run",
    "--trigger",
    "launchd",
    ...(opts.steps && opts.steps.length > 0 ? ["--steps", opts.steps.join(",")] : []),
  ];
}

export function buildJobsPlist(opts: {
  label: string;
  intervalSeconds: number;
  programArguments: string[];
  stdoutPath: string;
  stderrPath: string;
}): string {
  const args = opts.programArguments
    .map((arg) => `    <string>${xmlEscape(arg)}</string>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(opts.label)}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>StartInterval</key>
  <integer>${Math.max(60, Math.floor(opts.intervalSeconds))}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(opts.stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(opts.stderrPath)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${LAUNCHD_PATH}</string>
  </dict>
</dict>
</plist>
`;
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
