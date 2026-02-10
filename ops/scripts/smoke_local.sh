#!/usr/bin/env bash
set -euo pipefail

# Local smoke:
# - starts a tiny server
# - fetches /index.html and checks HTML build + main.js?v match expected

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

PORT="${PORT:-4173}"
HOST="${HOST:-127.0.0.1}"
URL="http://${HOST}:${PORT}/index.html"

EXPECTED="$(node ops/scripts/read_expected_version.mjs 2>/dev/null || true)"
if [[ -z "$EXPECTED" ]]; then
  echo "ERROR: could not read expected version from src/main.js" >&2
  exit 2
fi

SERVER_PID=""
cleanup() {
  if [[ -n "${SERVER_PID}" ]]; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

python3 -m http.server "${PORT}" --bind "${HOST}" >/dev/null 2>&1 &
SERVER_PID="$!"

for _ in {1..40}; do
  if curl -fsS "${URL}" >/dev/null 2>&1; then break; fi
  sleep 0.05
done

HTML="$(curl -fsS "${URL}")"

echo "${HTML}" | grep -q "HTML build: v${EXPECTED}" || {
  echo "ERROR: index.html HTML build tag mismatch (expected v${EXPECTED})" >&2
  exit 1
}

echo "${HTML}" | grep -Eq "src/main\\.js\\?v=${EXPECTED}(['\"])?" || {
  echo "ERROR: index.html main.js cache-buster mismatch (expected ?v=${EXPECTED})" >&2
  exit 1
}

echo "SMOKE OK: HTML build v${EXPECTED} and main.js?v=${EXPECTED}"
