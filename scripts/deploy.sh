#!/bin/bash
# Snapshot current working dir to git, then deploy to Railway.
#
# Usage:
#   ./scripts/deploy.sh                       # auto message
#   ./scripts/deploy.sh "phase 2: youtube"    # custom message
#
# Exits early on git error so we never deploy code that didn't get snapshotted.

set -e

cd "$(dirname "$0")/.."

# Bring in any remote-only commits first (Railway, other devices). Stash any
# fully-untracked-but-not-yet-staged changes if needed.
git fetch origin
git pull --rebase --autostash origin main || {
  echo "❌ git pull --rebase failed — resolve conflicts, then re-run." >&2
  exit 1
}

# Stage everything tracked + untracked, commit if anything changed.
git add -A
if git diff --cached --quiet; then
  echo "ℹ  No file changes to snapshot."
else
  MSG="${1:-Snapshot $(date +%Y-%m-%d_%H:%M)}"
  git commit -m "$MSG"
fi

git push origin main

echo ""
echo "✅ Snapshot pushed. Deploying to Railway…"
echo ""
railway up
