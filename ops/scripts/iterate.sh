#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

VER=${1:-}
if [[ -z "$VER" ]]; then
  echo "Usage: bash ops/scripts/iterate.sh v0.0.54"
  exit 1
fi

bash ops/scripts/smoke_local.sh
node ops/scripts/bump_version.mjs "$VER"

echo
echo "Next steps:"
echo "  git status"
echo "  git add -A && git commit -m \"$VER\" && git push"
echo "  node ops/scripts/pages_check.mjs $VER"
