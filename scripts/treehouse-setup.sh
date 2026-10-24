#!/usr/bin/env bash
#
# Pre-warm a Conventioner worktree so an agent can start immediately.
# Idempotent: an already-warm worktree is detected and left untouched, so this
# stays fast on pool hits.
#
# A fresh git checkout has no git-ignored files, so we recreate:
#   - .env files (copied from the primary checkout)
#   - front-end/node_modules           -> front-end / JS tooling works locally
# and points git at the committed hooks (.githooks/), which keep real people's details off GitHub.
#
# Back-end Python is intentionally NOT set up as a local venv: the project runs
# the back-end via Docker (python:3.12-slim, see back-end/Dockerfile), and this
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

# 2. Node dependencies (skip if already present — pool hit). `npm ci` installs exactly the
#    committed lockfile and never writes it: `npm install` lets an npm other than the one that
#    wrote the lockfile rewrite it, which leaves the slot dirty and unusable.
if [ ! -d "$WORKTREE/front-end/node_modules" ]; then
  echo "[treehouse]   npm ci (front-end)"
  if ! npm ci --prefix "$WORKTREE/front-end" --no-audit --no-fund --silent; then
    echo "[treehouse]   ERROR: npm ci failed in front-end; if package-lock.json is out of step with package.json, fix and commit the lockfile on its branch - the pre-warm never rewrites it" >&2
    rm -rf "$WORKTREE/front-end/node_modules"
    exit 1
  fi
fi

# 3. Back-end Python venv — OFF by default (see header). Best-effort when opted
#    in; a failure warns but never aborts the pre-warm.
if [ "${TREEHOUSE_BUILD_VENV:-0}" = "1" ] && [ ! -x "$WORKTREE/back-end/env/bin/python" ]; then
  echo "[treehouse]   python venv + pip install (back-end, best-effort)"
  if python3 -m venv "$WORKTREE/back-end/env" \
     && "$WORKTREE/back-end/env/bin/pip" install -q --upgrade pip \
     && "$WORKTREE/back-end/env/bin/pip" install -q -r "$WORKTREE/back-end/requirements.txt" -r "$WORKTREE/back-end/requirements-floorplan-solver.txt"; then
    echo "[treehouse]   venv ready"
  else
    echo "[treehouse]   WARNING: venv build failed — removing partial env; use Docker for the back-end" >&2
    rm -rf "$WORKTREE/back-end/env"
  fi
fi

# 4. The committed git hooks: they refuse a commit or a push that holds a real person's details
#    (scripts/real_data_check.py). The setting is the repository's, so every worktree gets it.
git -C "$WORKTREE" config core.hooksPath .githooks

echo "[treehouse] ready: $WORKTREE"
