# Releasing

Operator procedure for shipping a release. The mechanics live in
`.github/workflows/release.yml` and `.github/workflows/bump-homebrew.yml`;
this doc is the human-facing flow.

## Flow

### 1. Bump both version locations

The version lives in two places and must match:

- `packages/cli/package.json` `version`
- `packages/core/src/constants.ts` `VERSION` (what `reddit-cached --version`
  reports)

The release workflow's verify job fails the run if they disagree with each
other or with the tag.

### 2. Push the tag

```bash
git tag v0.2.0
git push origin v0.2.0
```

The tag's base (everything before the first `-`) must equal the package
version. A hyphenated tag (`v0.2.0-rc1`) is a prerelease by repo convention:
it builds and drafts, but never moves the Homebrew tap or npm.

### 3. CI builds and drafts

On tag push, `release.yml` runs:

- **Verify version** — tag ↔ `packages/cli/package.json` ↔
  `packages/core/src/constants.ts` all match.
- **Build release assets** — `bun run verify`, then packages four platform
  tarballs (`darwin-arm64`, `darwin-amd64`, `linux-amd64`, `linux-arm64`),
  `reddit-cached-extension.zip` (Chrome), `reddit-cached-extension-firefox.zip`
  (same files with the Firefox manifest; ships from the first tag after
  v0.1.0), and `SHA256SUMS`, then smoke-tests the extracted linux-amd64
  tarball with `packages/cli/scripts/smoke-binary.sh` — the exact bytes that
  ship, not a rebuild.
- **Release** — creates a **draft** GitHub release with the assets and
  generated notes.

### 4. Operator verifies and publishes

Download the assets from the draft, verify them locally (checksums, run the
host binary, `serve` boots), then publish the release. Publishing is the
manual gate — nothing reaches consumers until you un-draft.

### 5. Automatic follow-on

Publishing a stable release (no prerelease flag, no `-` in the tag) triggers:

- **Homebrew tap bump** (`bump-homebrew.yml`) — regenerates
  `Formula/reddit-cached.rb` in `aurokin/homebrew-tap` from the published
  `SHA256SUMS`, pushed with the `HOMEBREW_TAP_TOKEN` secret (fine-grained PAT;
  `GITHUB_TOKEN` cannot write another repo).
- **npm publish** (`publish-npm` job in `release.yml`) — publishes the
  `reddit-cached` package using the `NPM_TOKEN` secret. If the secret is not
  configured the job skips cleanly instead of failing.

Both are proven paths; no manual tap or npm step is needed.

## Escape hatch: workflow_dispatch

`release.yml` can be dispatched manually on a branch to exercise the
build/package path before tagging. Dispatch skips the version check and the
release job — artifacts are uploaded to the workflow run for local
validation, and nothing is drafted or published.
