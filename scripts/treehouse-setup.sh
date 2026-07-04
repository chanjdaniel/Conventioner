#!/usr/bin/env bash
#
# Pre-warm a Conventioner worktree so an agent can start immediately.
# Idempotent: an already-warm worktree is detected and left untouched, so this
# stays fast on pool hits.
#
# A fresh git checkout has no git-ignored files, so we recreate:
#   - .env files (copied from the primary checkout)
#   - node_modules (root + front-end)  -> front-end / JS tooling works locally
#
# Back-end Python is intentionally NOT set up as a local venv: the project runs
# the back-end via Docker (python:3.11-slim, see docker-compose.yml), and this
# machine only has Python 3.13/3.14, on which the pinned deps won't build.
# Set TREEHOUSE_BUILD_VENV=1 to attempt a local venv anyway (best-effort).
#
# Usage: TREEHOUSE_DIR=<worktree-path> scripts/treehouse-setup.sh
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

# 3. Back-end Python venv — OFF by default (see header). Best-effort when opted
#    in; a failure warns but never aborts the pre-warm.
if [ "${TREEHOUSE_BUILD_VENV:-0}" = "1" ] && [ ! -x "$WORKTREE/back-end/env/bin/python" ]; then
  echo "[treehouse]   python venv + pip install (back-end, best-effort)"
  if python3 -m venv "$WORKTREE/back-end/env" \
     && "$WORKTREE/back-end/env/bin/pip" install -q --upgrade pip \
     && "$WORKTREE/back-end/env/bin/pip" install -q -r "$WORKTREE/back-end/requirements.txt"; then
    echo "[treehouse]   venv ready"
  else
    echo "[treehouse]   WARNING: venv build failed — removing partial env; use Docker for the back-end" >&2
    rm -rf "$WORKTREE/back-end/env"
  fi
fi

echo "[treehouse] ready: $WORKTREE"
