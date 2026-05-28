---
description: Emergency rollback. Pass a version (v0.0.65) or commit SHA. Confirms before any destructive git operation.
allowed-tools: Bash, Read
argument-hint: <vX.Y.Z | commit-SHA>
---

# Rollback

**Target:** $ARGUMENTS

Reverts `src/main.js` and `index.html` only. No other files are touched.

## Step 1 — Locate the target commit

If argument matches `v\d+\.\d+\.\d+`: run `git log --oneline --all --grep="$ARGUMENTS"` to find the commit.
Otherwise: run `git show --oneline --no-patch $ARGUMENTS` to verify the SHA exists.

If not found: STOP. Tell the user and suggest running `git log --oneline` to find the right reference.

## Step 2 — Show the diff

Run: `git diff HEAD..<commit> -- src/main.js index.html`

Print the diff so the user can see exactly what changes. If diff is empty: tell the user these files are already identical at the target — nothing to roll back.

## Step 3 — Confirm (REQUIRED)

Print verbatim:

```
⚠️  ROLLBACK CONFIRMATION REQUIRED

This will overwrite src/main.js and index.html with their state at <commit>.
All uncommitted changes to those files will be lost.

Type "yes" to proceed or anything else to cancel.
```

Wait for user response. If not exactly `yes`: STOP without making any changes.

## Step 4 — Restore files

Run: `git checkout <commit> -- src/main.js index.html`

On failure: STOP and print the git error.

Verify: `node ops/scripts/read_expected_version.mjs` — print the restored version.

## Step 5 — Smoke check

Run: `node ops/scripts/smoke_local.mjs`

Both files come from the same commit so their versions should match. On failure: STOP. Advise user to try a different commit, or run `node ops/scripts/bump_version.mjs +patch` to re-sync.

## Step 6 — Deploy

Run: `npm run deploy`

`deploy.sh` bumps the version (+patch from the restored base), commits, pushes, and polls Pages.

**Do NOT call `bump_version.mjs` separately** — that would double-bump.

On exit non-zero: STOP and print the error.

## Done

Run `node ops/scripts/read_expected_version.mjs` and report: "Rollback complete. Deployed v{version}."
