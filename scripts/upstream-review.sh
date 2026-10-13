#!/usr/bin/env bash
# scripts/upstream-review.sh - show what upstream changed since this fork's pin.
#
# Usage: bash scripts/upstream-review.sh [ref]     (default ref: upstream/main)
#
# Read-only. Fetches the upstream remote, then prints the commit log, a diffstat
# and the full diff from UPSTREAM_BASE to <ref>. It never merges: after reading
# the diff, merge by hand and update UPSTREAM_BASE to the commit you reviewed.
set -euo pipefail
cd "$(dirname "$0")/.."

BASE="$(tr -d '[:space:]' < UPSTREAM_BASE)"
REF="${1:-upstream/main}"

if ! git remote get-url upstream >/dev/null 2>&1; then
  echo "No 'upstream' remote. Add it with:" >&2
  echo "  git remote add upstream https://github.com/stephenlthorn/auto-identity-remove.git" >&2
  exit 1
fi

git fetch --quiet upstream
echo "== Commits in $REF since pinned base ${BASE:0:7} =="
git --no-pager log --oneline "$BASE..$REF"
echo
echo "== Files touched =="
git --no-pager diff --stat "$BASE" "$REF"
echo
echo "== Dependency manifest changes (read these first) =="
git --no-pager diff "$BASE" "$REF" -- package.json package-lock.json
echo
echo "== Full diff =="
git --no-pager diff "$BASE" "$REF"
