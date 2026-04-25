# Workspace Harness

## Purpose

This is the authoritative repo-level verification routine. It answers two
questions:

- what commands should a contributor trust
- what each command proves when it passes

If a verification path only works through hidden setup or package-specific
tribal knowledge, it is not the workspace harness.

## Reader Path

- Read [../architecture.md](../architecture.md) for the stable system model.
- Read [./web.md](./web.md) for the web-specific harness.
- Read [../tracking.md](../tracking.md) for active hardening work.

## Authoritative Routine

Run these from the repo root unless noted otherwise:

```bash
bun install
bun run verify
```

`bun run verify` runs the authoritative checks in this order:

```bash
bun run typecheck
bun test
bun run --filter @reddit-saved/web build
cd packages/cli && bun run src/index.ts --help
```

## What Each Check Proves

| Check | What it proves |
|---|---|
| `bun run typecheck` | Cross-package TypeScript surfaces still line up |
| `bun test` | The shared workspace behavior is intact under the documented test harness |
| `bun run --filter @reddit-saved/web build` | The web package can build its production SPA bundle |
| `cd packages/cli && bun run src/index.ts --help` | The CLI entrypoint boots and command wiring is intact |

## Package-Scoped Probes

Use these when narrowing a failure after the root routine has already told you
where to look:

```bash
cd packages/core && bun test
cd packages/cli && bun test
cd packages/web && bun run test
cd packages/web && bun run test:e2e
```

These are diagnostic harnesses, not substitutes for the root routine.

## Current Observations

At the current repo snapshot:

- `bun run verify` passes
- `bun run typecheck` passes
- `bun test` passes at the workspace root
- `bun run --filter @reddit-saved/web build` passes
- `cd packages/cli && bun run src/index.ts --help` passes
- package-script tests also pass with `bun run --filter '*' test`

When this changes, update this doc rather than layering exceptions into command
comments or issue bodies.
