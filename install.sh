#!/usr/bin/env bash
# Installs the latest reddit-cached release binary to ~/.local/bin (no sudo).
#
#   curl -fsSL https://raw.githubusercontent.com/aurokin/reddit_cached/main/install.sh | bash
#
# Downloads the platform tarball from the latest GitHub release, verifies it
# against the release's SHA256SUMS manifest, and extracts the single
# `reddit-cached` binary. REDDIT_CACHED_INSTALL_BASE_URL overrides the
# download base (used by local testing against a directory of assets).
set -euo pipefail

REPO="aurokin/reddit_cached"
BASE_URL="${REDDIT_CACHED_INSTALL_BASE_URL:-https://github.com/$REPO/releases/latest/download}"
INSTALL_DIR="$HOME/.local/bin"

fail() {
  echo "install: $1" >&2
  exit 1
}

case "$(uname -s)" in
  Darwin) os="darwin" ;;
  Linux) os="linux" ;;
  MINGW* | MSYS* | CYGWIN* | Windows_NT)
    fail "Windows is not supported" ;;
  *)
    fail "unsupported operating system: $(uname -s) (supported: macOS, Linux)" ;;
esac

case "$(uname -m)" in
  arm64 | aarch64) arch="arm64" ;;
  x86_64 | amd64) arch="amd64" ;;
  *)
    fail "unsupported architecture: $(uname -m) (supported: arm64, x86_64)" ;;
esac

asset="reddit-cached-$os-$arch.tar.gz"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

echo "Downloading $asset from $BASE_URL ..."
curl -fsSL "$BASE_URL/$asset" -o "$tmp_dir/$asset" \
  || fail "download failed for $BASE_URL/$asset — check https://github.com/$REPO/releases"
curl -fsSL "$BASE_URL/SHA256SUMS" -o "$tmp_dir/SHA256SUMS" \
  || fail "download failed for $BASE_URL/SHA256SUMS"

cd "$tmp_dir"
grep " $asset\$" SHA256SUMS > checksum || fail "$asset missing from SHA256SUMS"
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum -c checksum >/dev/null || fail "checksum mismatch for $asset"
else
  shasum -a 256 -c checksum >/dev/null || fail "checksum mismatch for $asset"
fi

mkdir -p "$INSTALL_DIR"
tar -xzf "$asset" -C "$INSTALL_DIR" reddit-cached
chmod +x "$INSTALL_DIR/reddit-cached"

echo "Installed reddit-cached $("$INSTALL_DIR/reddit-cached" --version) to $INSTALL_DIR/reddit-cached"

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    echo ""
    echo "Note: $INSTALL_DIR is not on your PATH. Add it with:"
    echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
    ;;
esac
