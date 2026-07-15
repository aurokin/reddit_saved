#!/usr/bin/env bash
# Smoke test for the compiled single-file binary: CLI commands work and
# `serve` hosts the API plus the embedded SPA. Build first with
# `bun run build:binary` (repo root). Run from anywhere:
#
#   packages/cli/scripts/smoke-binary.sh [path/to/reddit-cached] [port]
set -euo pipefail

BINARY="${1:-$(cd "$(dirname "$0")/.." && pwd)/dist/reddit-cached}"
BINARY="$(cd "$(dirname "$BINARY")" && pwd)/$(basename "$BINARY")" # the script cds away later
# Default to a random high port so parallel/stale runs don't collide; the
# pre-flight check below rejects a squatted port either way.
PORT="${2:-$(( (RANDOM % 20000) + 20000 ))}"
BASE="http://127.0.0.1:$PORT"

if [[ ! -x "$BINARY" ]]; then
  echo "smoke-binary: no binary at $BINARY — run 'bun run build:binary' first" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
export REDDIT_CACHED_DB="$TMP_DIR/smoke.db"
SERVER_PID=""
cleanup() {
  [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

fail() {
  echo "smoke-binary: FAIL — $1" >&2
  exit 1
}

cd "$TMP_DIR" # prove the binary is cwd-independent

# --- CLI surface ---
"$BINARY" --version >/dev/null || fail "--version"
# Every surface resolves the DB as --db > REDDIT_CACHED_DB > platform default;
# prove both the flag and the env var (already exported above) paths work.
"$BINARY" status --db "$REDDIT_CACHED_DB" | grep -q '"totalPosts"' || fail "status did not emit stats JSON"
"$BINARY" status | grep -q '"totalPosts"' || fail "status did not honor REDDIT_CACHED_DB"

# --- serve: API + embedded SPA ---
# Refuse a squatted port: a stale server here would answer the checks below
# and produce a false pass against the wrong binary.
if curl -s -o /dev/null --max-time 2 "$BASE/"; then
  fail "port $PORT is already serving HTTP — pass a free port"
fi

"$BINARY" serve --port "$PORT" &
SERVER_PID=$!
for _ in $(seq 1 50); do
  kill -0 "$SERVER_PID" 2>/dev/null || fail "serve exited during startup"
  curl -sf "$BASE/api/health" >/dev/null 2>&1 && break
  sleep 0.1
done

curl -sf "$BASE/api/health" | grep -q '"ok":true' || fail "/api/health"

INDEX="$(curl -sf "$BASE/")"
echo "$INDEX" | grep -q '<div id="root">' || fail "/ did not return the SPA index"

JS_PATH="$(echo "$INDEX" | grep -o '/assets/[^"]*\.js' | head -1)"
[[ -n "$JS_PATH" ]] || fail "no hashed /assets/*.js referenced by index.html"
JS_TYPE="$(curl -sf -o /dev/null -w '%{content_type}' "$BASE$JS_PATH")"
[[ "$JS_TYPE" == application/javascript* ]] || fail "$JS_PATH content-type was '$JS_TYPE'"

FAVICON_STATUS="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/favicon.svg")"
[[ "$FAVICON_STATUS" == 200 ]] || fail "/favicon.svg returned $FAVICON_STATUS"

echo "smoke-binary: OK ($BINARY on $BASE)"
