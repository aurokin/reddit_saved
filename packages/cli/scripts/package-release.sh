#!/usr/bin/env bash
# Release packaging: cross-compiles the CLI binary for every supported
# target, zips the browser extension, and writes a SHA256SUMS manifest —
# everything the release workflow uploads as assets. Runs locally too:
#
#   packages/cli/scripts/package-release.sh
#
# Output (repo-root dist-release/, gitignored):
#   reddit-cached-darwin-arm64.tar.gz   (tarball contains one file: reddit-cached)
#   reddit-cached-darwin-amd64.tar.gz
#   reddit-cached-linux-amd64.tar.gz
#   reddit-cached-linux-arm64.tar.gz
#   reddit-cached-extension.zip         (Chrome "load unpacked" contents)
#   reddit-cached-extension-firefox.zip (same files, Firefox manifest)
#   SHA256SUMS                          (GNU sha256sum format)
#
# Asset names use Go-style arch (x64 -> amd64) to match the owner's other
# release pipelines and the Homebrew formula URLs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CLI_DIR="$ROOT/packages/cli"
OUT_DIR="$ROOT/dist-release"

# bun target -> asset suffix (tprompt convention: x64 is amd64)
TARGETS=(
  "bun-darwin-arm64:darwin-arm64"
  "bun-darwin-x64:darwin-amd64"
  "bun-linux-x64:linux-amd64"
  "bun-linux-arm64:linux-arm64"
)

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# --- web build (embedded into every binary; target-independent) ---
(cd "$ROOT" && bun run --filter @reddit-cached/web build)

# --- CLI binaries ---
for entry in "${TARGETS[@]}"; do
  bun_target="${entry%%:*}"
  asset="${entry##*:}"
  stage="$OUT_DIR/stage-$asset"
  mkdir -p "$stage"
  (cd "$CLI_DIR" && bun run scripts/build-binary.ts \
    "--target=$bun_target" "--outfile=$stage/reddit-cached")
  tar -C "$stage" -czf "$OUT_DIR/reddit-cached-$asset.tar.gz" reddit-cached
  rm -rf "$stage"
done

# --- browser extension (Chrome + Firefox builds; load-ready contents) ---
# Run the build script with bun directly; the package.json script shells out
# to node, which isn't otherwise required by this repo. It stages dist/chrome
# and dist/firefox, each with the right manifest.json for its browser.
(cd "$ROOT/packages/extension" && bun scripts/build.js)
(cd "$ROOT/packages/extension/dist/chrome" && zip -qr "$OUT_DIR/reddit-cached-extension.zip" .)
(cd "$ROOT/packages/extension/dist/firefox" && zip -qr "$OUT_DIR/reddit-cached-extension-firefox.zip" .)

# --- checksums (GNU sha256sum format; shasum matches it on macOS) ---
cd "$OUT_DIR"
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum -- *.tar.gz *.zip > SHA256SUMS
else
  shasum -a 256 -- *.tar.gz *.zip > SHA256SUMS
fi

echo "package-release: wrote $(ls -1 | wc -l | tr -d ' ') assets to $OUT_DIR"
ls -l
