#!/usr/bin/env bash
#
# Run the Conventioner docker-compose stack for a specific worktree, isolated so
# multiple worktrees can run in parallel.
#
# Usage (from inside a leased worktree):
#     /path/to/main/Conventioner/scripts/th-compose.sh up -d
#     /path/to/main/Conventioner/scripts/th-compose.sh logs -f backend
#     /path/to/main/Conventioner/scripts/th-compose.sh down -v
#
# Or target a worktree explicitly:  TH_DIR=<worktree> th-compose.sh up -d
#
# Or provide an explicit stack identity (for non-treehouse contexts like CI or
# no-mistakes gates):
#     COMPOSE_PROJECT_NAME=nmtest-12345  TH_BACKEND_PORT=...  TH_FRONTEND_PORT=...
#     TH_MONGO_PORT=...  TH_MONGO_EXPRESS_PORT=...  th-compose.sh up -d
#
# Resolution order:
#   1. COMPOSE_PROJECT_NAME + TH_BACKEND_PORT already set -> use as-is
#   2. Treehouse slot regex on path -> derive from slot offset
#   3. Fail loud
#
# Port map per slot (offset = slot * 10):
#   slot 1 -> mongo 27027  backend 5010  frontend 5183  mongo-express 8091
#   slot 2 -> mongo 27037  backend 5020  frontend 5193  mongo-express 8101
#   main   -> defaults     27017 / 5000 / 5173 / 8081
#
set -euo pipefail

# Repo root = parent of this script's dir, so this works from any clone location.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OVERLAY="$REPO/docker-compose.worktree.yml"

WT="${TH_DIR:-$PWD}"
if [ ! -f "$WT/docker-compose.yml" ]; then
  echo "th-compose: no docker-compose.yml in '$WT' — cd into a worktree or set TH_DIR" >&2
  exit 1
fi

# Resolution order: 1) explicit env  2) treehouse slot  3) fail loud
if [ -n "${COMPOSE_PROJECT_NAME:-}" ] && [ -n "${TH_BACKEND_PORT:-}" ] && [ -n "${TH_MONGO_PORT:-}" ] && [ -n "${TH_FRONTEND_PORT:-}" ] && [ -n "${TH_MONGO_EXPRESS_PORT:-}" ]; then
  # Explicit stack identity provided — use it as-is. The caller owns every
  # TH_* port variable and the project name. We skip slot detection entirely
  # so this works from a no-mistakes worktree, CI, or any directory.
  :
elif SLOT="$(printf '%s' "$WT" | sed -nE 's#.*/\.treehouse/[^/]+/([0-9]+)/.*#\1#p')" && [[ "$SLOT" =~ ^[0-9]+$ ]]; then
  OFF=$((SLOT * 10))
  export COMPOSE_PROJECT_NAME="conventioner-$SLOT"
  export TH_MONGO_PORT=$((27017 + OFF))
  export TH_BACKEND_PORT=$((5000 + OFF))
  export TH_FRONTEND_PORT=$((5173 + OFF))
  export TH_MONGO_EXPRESS_PORT=$((8081 + OFF))
else
  echo "th-compose: '$WT' is not a treehouse worktree and COMPOSE_PROJECT_NAME / TH_BACKEND_PORT are not set." >&2
  echo "            Set COMPOSE_PROJECT_NAME, TH_BACKEND_PORT, TH_FRONTEND_PORT," >&2
  echo "            TH_MONGO_PORT, and TH_MONGO_EXPRESS_PORT in the environment" >&2
  echo "            to provide an explicit stack identity, or run from inside a" >&2
  echo "            treehouse worktree. For the primary checkout, use plain" >&2
  echo "            'docker compose' instead." >&2
  exit 1
fi

echo "th-compose: project=${COMPOSE_PROJECT_NAME:-?}  mongo=${TH_MONGO_PORT:-?}  backend=${TH_BACKEND_PORT:-?}  frontend=${TH_FRONTEND_PORT:-?}  mongo-express=${TH_MONGO_EXPRESS_PORT:-?}" >&2

exec docker compose -f "$WT/docker-compose.yml" -f "$OVERLAY" "$@"
