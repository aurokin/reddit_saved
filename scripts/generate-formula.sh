#!/usr/bin/env bash
# Renders the Homebrew formula for a published release from its SHA256SUMS
# manifest. Called by .github/workflows/bump-homebrew.yml; runnable locally
# against a dist-release/ manifest to validate the output with `brew style`:
#
#   scripts/generate-formula.sh v0.1.0 dist-release/SHA256SUMS /tmp/reddit-cached.rb
#
# Usage: generate-formula.sh <tag> <sha256sums-path> [output-path]
# Writes to stdout when no output path is given.
set -euo pipefail

if [ $# -lt 2 ] || [ $# -gt 3 ]; then
  echo "usage: $0 <tag> <sha256sums-path> [output-path]" >&2
  exit 1
fi

TAG="$1"
SUMS="$2"
OUT="${3:-/dev/stdout}"
VERSION="${TAG#v}"

sha_for() {
  local f="$1" h
  h="$(awk -v f="$f" '$2 == f { print $1 }' "$SUMS")"
  if [ -z "$h" ]; then
    echo "generate-formula: missing sha256 for $f in $SUMS" >&2
    exit 1
  fi
  printf '%s' "$h"
}

SHA_DARWIN_ARM64="$(sha_for reddit-cached-darwin-arm64.tar.gz)"
SHA_DARWIN_AMD64="$(sha_for reddit-cached-darwin-amd64.tar.gz)"
SHA_LINUX_ARM64="$(sha_for reddit-cached-linux-arm64.tar.gz)"
SHA_LINUX_AMD64="$(sha_for reddit-cached-linux-amd64.tar.gz)"

cat > "$OUT" <<RUBY
class RedditCached < Formula
  desc "Local-first archive of your Reddit saved, upvoted, and posted content"
  homepage "https://github.com/aurokin/reddit_cached"
  version "$VERSION"
  license "MIT"

  livecheck do
    url :stable
    strategy :git
    regex(/^v?(\\d+(?:\\.\\d+)+)\$/i)
  end

  on_macos do
    on_arm do
      url "https://github.com/aurokin/reddit_cached/releases/download/$TAG/reddit-cached-darwin-arm64.tar.gz"
      sha256 "$SHA_DARWIN_ARM64"
    end
    on_intel do
      url "https://github.com/aurokin/reddit_cached/releases/download/$TAG/reddit-cached-darwin-amd64.tar.gz"
      sha256 "$SHA_DARWIN_AMD64"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/aurokin/reddit_cached/releases/download/$TAG/reddit-cached-linux-arm64.tar.gz"
      sha256 "$SHA_LINUX_ARM64"
    end
    on_intel do
      url "https://github.com/aurokin/reddit_cached/releases/download/$TAG/reddit-cached-linux-amd64.tar.gz"
      sha256 "$SHA_LINUX_AMD64"
    end
  end

  def install
    bin.install "reddit-cached"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/reddit-cached --version")
  end
end
RUBY
