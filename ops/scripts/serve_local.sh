#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-8080}"

# Serve repo root (so /index.html works). No build step required.
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
PID=$!

echo "$PID" > .server.pid

echo "Serving on http://127.0.0.1:${PORT} (pid ${PID})"
