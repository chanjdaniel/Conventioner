#!/usr/bin/env bash
#
# Run the Conventioner docker-compose stack for a specific worktree, isolated so
# multiple worktrees can run in parallel. Derives a stable slot id from the
# worktree path and offsets host ports + project/container names accordingly.
#
# Usage (from inside a leased worktree):
#     /path/to/main/Conventioner/scripts/th-compose.sh up -d
#     /path/to/main/Conventioner/scripts/th-compose.sh logs -f backend
#     /path/to/main/Conventioner/scripts/th-compose.sh down -v
#
# Or target a worktree explicitly:  TH_DIR=<worktree> th-compose.sh up -d
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

# Slot = the numeric pool index in ~/.treehouse/<pool>/<N>/Conventioner.
SLOT="$(printf '%s' "$WT" | sed -nE 's#.*/\.treehouse/[^/]+/([0-9]+)/.*#\1#p')"
if [[ ! "$SLOT" =~ ^[0-9]+$ ]]; then
  echo "th-compose: '$WT' is not a treehouse worktree." >&2
  echo "            For the primary checkout use plain 'docker compose' instead;" >&2
  echo "            th-compose.sh is only for leased worktrees (offset ports)." >&2
  exit 1
fi
OFF=$((SLOT * 10))

export COMPOSE_PROJECT_NAME="conventioner-$SLOT"
export TH_MONGO_PORT=$((27017 + OFF))
export TH_BACKEND_PORT=$((5000 + OFF))
export TH_FRONTEND_PORT=$((5173 + OFF))
export TH_MONGO_EXPRESS_PORT=$((8081 + OFF))

echo "th-compose: project=$COMPOSE_PROJECT_NAME  mongo=$TH_MONGO_PORT  backend=$TH_BACKEND_PORT  frontend=$TH_FRONTEND_PORT  mongo-express=$TH_MONGO_EXPRESS_PORT" >&2

exec docker compose -f "$WT/docker-compose.yml" -f "$OVERLAY" "$@"
