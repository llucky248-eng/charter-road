#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

node ops/scripts/bump_version.mjs +patch
VERSION=$(node ops/scripts/read_expected_version.mjs)
git add index.html src/main.js
git commit -m "v${VERSION}"
git push

echo "Waiting for Pages CDN (8s)..."
sleep 8
node ops/scripts/pages_check.mjs "v${VERSION}" || {
  echo ""
  echo "PAGES CHECK FAILED. To rollback:"
  echo "  git revert HEAD --no-edit"
  echo "  node ops/scripts/bump_version.mjs +patch"
  echo "  bash ops/scripts/deploy.sh"
  exit 1
}
