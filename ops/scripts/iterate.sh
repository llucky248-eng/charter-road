#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

ARG="${1:-+patch}"

node ops/scripts/bump_version.mjs "$ARG"
node ops/scripts/smoke_local.mjs

echo
echo "Next:"
echo "  git status"
echo "  git add index.html src/main.js && git commit -m \"v${ARG#v}\" && git push"
echo "  node ops/scripts/pages_check.mjs v$(node ops/scripts/read_expected_version.mjs)"
