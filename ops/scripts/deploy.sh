#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

node ops/scripts/bump_version.mjs +patch
VERSION=$(node ops/scripts/read_expected_version.mjs)
git add index.html src/main.js
git commit -m "v${VERSION}"

BRANCH=$(git rev-parse --abbrev-ref HEAD)
attempt=1; delay=2
while ! git push -u origin "$BRANCH"; do
  if [[ $attempt -ge 4 ]]; then echo "ERROR: git push failed after 4 attempts" >&2; exit 1; fi
  echo "Push failed, retrying in ${delay}s..."
  sleep "$delay"; delay=$((delay * 2)); attempt=$((attempt + 1))
done

echo "Waiting for Pages to update (polling up to 90s)..."
DEADLINE=$(($(date +%s) + 90))
while true; do
  if node ops/scripts/pages_check.mjs "v${VERSION}" 2>/dev/null; then
    break
  fi
  if [[ $(date +%s) -ge $DEADLINE ]]; then
    echo ""
    echo "PAGES CHECK FAILED after 90s. To rollback:"
    echo "  git revert HEAD --no-edit"
    echo "  node ops/scripts/bump_version.mjs +patch"
    echo "  bash ops/scripts/deploy.sh"
    exit 1
  fi
  echo "  not ready yet, retrying in 8s..."
  sleep 8
done
