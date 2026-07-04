#!/usr/bin/env bash
#
# Pre-warm a Conventioner worktree so an agent can start immediately.
# Idempotent: a reused, already-warm worktree is detected and left untouched,
# so this stays fast on pool hits. A fresh checkout has no git-ignored files,
# so we recreate: .env files, node_modules (root + front-end), and the
# back-end/env Python venv.
#
# Usage: TREEHOUSE_DIR=<worktree-path> scripts/treehouse-setup.sh
# (Called by scripts/th-lease.sh. NOTE: treehouse v2.0.0 does not invoke
#  post_create hooks, so we drive this from the lease wrapper, not from
#  treehouse.toml.)
#
set -euo pipefail

WORKTREE="${TREEHOUSE_DIR:-$PWD}"
cd "$WORKTREE"

# Primary checkout = parent of the shared .git dir. Source for git-ignored files.
MAIN="$(cd "$(dirname "$(git rev-parse --git-common-dir)")" && pwd)"

# 1. Env files (git-ignored, absent in a fresh checkout)
for f in .env front-end/.env back-end/.env; do
  if [ ! -f "$WORKTREE/$f" ] && [ -f "$MAIN/$f" ]; then
    cp "$MAIN/$f" "$WORKTREE/$f"
    echo "[treehouse]   copied $f"
  fi
done

# 2. Node dependencies (skip if already present — pool hit)
if [ ! -d "$WORKTREE/node_modules" ]; then
  echo "[treehouse]   npm install (root)"
  npm install --prefix "$WORKTREE" --no-audit --no-fund --silent
fi
if [ ! -d "$WORKTREE/front-end/node_modules" ]; then
  echo "[treehouse]   npm install (front-end)"
  npm install --prefix "$WORKTREE/front-end" --no-audit --no-fund --silent
fi

# 3. Python venv for the back-end (skip if already present)
if [ ! -x "$WORKTREE/back-end/env/bin/python" ]; then
  echo "[treehouse]   python venv + pip install (back-end)"
  python3 -m venv "$WORKTREE/back-end/env"
  "$WORKTREE/back-end/env/bin/pip" install -q --upgrade pip
  "$WORKTREE/back-end/env/bin/pip" install -q -r "$WORKTREE/back-end/requirements.txt"
fi

echo "[treehouse] ready: $WORKTREE"
