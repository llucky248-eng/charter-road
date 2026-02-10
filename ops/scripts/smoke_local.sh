#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

node -c src/main.js

echo "SMOKE OK: syntax"
