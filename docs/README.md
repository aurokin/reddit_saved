# Docs

This repo uses progressive disclosure documentation:

- durable docs describe what is true
- harness docs describe how to prove it
- execution tracking lives outside the repo docs

## Reader Paths

### I want to run the app

- Read [packages/web/README.md](../packages/web/README.md) for the local web
  workflow.
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

### I want to know where active work is tracked

- Read [tracking.md](./tracking.md). Repo docs are not the execution tracker.
