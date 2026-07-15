# Docs

This repo uses progressive disclosure documentation:

- durable docs describe what is true
- harness docs describe how to prove it
- execution tracking lives outside the repo docs

## Reader Paths

### I want to run the app

- Installed the binary (brew, install.sh, tarball, or bunx)? Read the
  [root README quickstart](../README.md) — install, `reddit-cached serve`,
  connect, sync, schedule.
- Read [packages/web/README.md](../packages/web/README.md) for the from-source
  and development web workflow.
- Read [packages/extension/README.md](../packages/extension/README.md) if you
  want the companion session-auth extension.

### I want to understand the system

- Read [architecture.md](./architecture.md) for package responsibilities,
  invariants, and product constraints.
- Read [adr/0001-cookie-session-auth.md](./adr/0001-cookie-session-auth.md) for
  the auth-mode decision.

### I want to verify behavior

- Read [harness/workspace.md](./harness/workspace.md) for the authoritative
  repo-level verification routine.
- Read [harness/web.md](./harness/web.md) for the seeded local web harness and
  web-specific proof points.

### I want command or route reference

- Read [interfaces/cli.md](./interfaces/cli.md) for the CLI command surface.
- Read [interfaces/web-api.md](./interfaces/web-api.md) for the local web API
  surface.

### I want to cut a release

- Read [releasing.md](./releasing.md) for the version-bump, tag, draft-verify,
  and publish flow, including what CI enforces and what happens automatically
  after publish.

### I want to know where active work is tracked

- Read [tracking.md](./tracking.md). Repo docs are not the execution tracker.
