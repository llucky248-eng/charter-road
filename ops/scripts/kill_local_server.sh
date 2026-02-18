#!/usr/bin/env bash
set -euo pipefail

if [[ -f .server.pid ]]; then
  PID=$(cat .server.pid)
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID"
    echo "Killed server pid $PID"
  fi
  rm -f .server.pid
else
  echo "No .server.pid found"
fi
