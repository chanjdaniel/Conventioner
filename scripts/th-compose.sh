#!/usr/bin/env bash
#
# Run the Conventioner docker-compose stack for a specific worktree, isolated so
# multiple worktrees can run in parallel.
#
# Usage (from inside a leased worktree, with the worktree's own copy, whose overlay is the one
# beside the worktree's compose file; another checkout's copy brings its own overlay):
#     scripts/th-compose.sh up -d
#     scripts/th-compose.sh logs -f backend
#     scripts/th-compose.sh down -v
#
# Or target a worktree explicitly:  TH_DIR=<worktree> th-compose.sh up -d
#
# Or provide an explicit stack identity (for non-treehouse contexts like CI):
#     COMPOSE_PROJECT_NAME=my-stack  TH_BACKEND_PORT=...  TH_FRONTEND_PORT=...
#     TH_MONGO_PORT=...  th-compose.sh up -d
#
# Or name the project and let Docker pick every host port (nm-test.sh does,
# so two runs never race for one port):
#     COMPOSE_PROJECT_NAME=nmtest-12345  TH_PORTS=auto  th-compose.sh up -d
# The `up` prints the assigned ports on stderr as TH_*_PORT= lines, and
#     eval "$(th-compose.sh ports)"
# exports the running stack's project and ports, in any mode.
#
# mongo-express is in the `tools` profile, so it starts only when asked for:
#     th-compose.sh --profile tools up -d mongo-express
# (TH_MONGO_EXPRESS_PORT names its host port; unset, Docker picks a free one.)
#
# Every port is published on 127.0.0.1 only.
#
# Every stack with the same dependencies runs the same two images, conventioner/backend:<tag> and
# conventioner/frontend:<tag>, tagged by scripts/image-tags.sh with a hash of the files each is
# built from; the source reaches the containers through their bind mounts. So an `up` builds an
# image only when none has its tag yet, and
#     th-compose.sh ensure-images
# builds the missing ones without starting anything. `th-compose.sh build` always builds.
#
# Resolution order:
#   1. TH_PORTS=auto + COMPOSE_PROJECT_NAME -> that project, every host port empty
#   2. COMPOSE_PROJECT_NAME + the three TH_*_PORT variables already set -> use as-is
#   3. Treehouse slot regex on path -> derive from slot offset
#   4. Fail loud
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
  echo "th-compose: no docker-compose.yml in '$WT' - cd into a worktree or set TH_DIR" >&2
  exit 1
fi

# Resolution order: 1) auto ports  2) explicit env  3) treehouse slot  4) fail loud
case "${TH_PORTS:-}" in
  "" | auto) ;;
  *)
    echo "th-compose: TH_PORTS='$TH_PORTS' is not a ports mode; the only one is TH_PORTS=auto." >&2
    exit 1
    ;;
esac
if [ "${TH_PORTS:-}" = auto ]; then
  if [ -z "${COMPOSE_PROJECT_NAME:-}" ]; then
    echo "th-compose: TH_PORTS=auto needs COMPOSE_PROJECT_NAME, the stack's own project name." >&2
    exit 1
  fi
  # An empty host port (127.0.0.1::<port>) makes Docker assign a free one as the container starts,
  # so two stacks started at once can never race for one port. Any port the caller set is ignored,
  # so the stack's config stays the same however it is called afterwards.
  export TH_MONGO_PORT="" TH_BACKEND_PORT="" TH_FRONTEND_PORT="" TH_MONGO_EXPRESS_PORT=""
elif [ -n "${COMPOSE_PROJECT_NAME:-}" ] && [ -n "${TH_BACKEND_PORT:-}" ] && [ -n "${TH_MONGO_PORT:-}" ] && [ -n "${TH_FRONTEND_PORT:-}" ]; then
  # Explicit stack identity provided - use it as-is. The caller owns every
  # TH_* port variable it sets and the project name. We skip slot detection entirely
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
  echo "            Set COMPOSE_PROJECT_NAME, TH_BACKEND_PORT, TH_FRONTEND_PORT" >&2
  echo "            and TH_MONGO_PORT in the environment to provide an explicit" >&2
  echo "            stack identity, COMPOSE_PROJECT_NAME and TH_PORTS=auto to let" >&2
  echo "            Docker pick the ports, or run from inside a" >&2
  echo "            treehouse worktree. For the primary checkout, use plain" >&2
  echo "            'docker compose' instead." >&2
  exit 1
fi

# The images' tags, computed from the worktree every time, whatever the caller set.
TAGS="$("$REPO/scripts/image-tags.sh" "$WT")"
while IFS='=' read -r var tag; do
  export "$var=$tag"
done <<<"$TAGS"

# A volume mounted inside a bind mount needs a mountpoint in the worktree, and Docker creates a
# missing one as root, which then outlives the stack and blocks deleting the worktree. So make
# each one as the user first - but only inside a source that exists: a worktree whose sources are
# gone must fail to start (the overlay's `create_host_path: false`), not start on empty folders.
for mountpoint in back-end/flask_session front-end/node_modules; do
  if [ -d "$WT/$(dirname "$mountpoint")" ]; then
    mkdir -p "$WT/$mountpoint"
  fi
done

if [ "${TH_PORTS:-}" = auto ]; then
  echo "th-compose: project=$COMPOSE_PROJECT_NAME  ports=auto (Docker picks each one)" >&2
else
  echo "th-compose: project=${COMPOSE_PROJECT_NAME:-?}  mongo=${TH_MONGO_PORT:-?}  backend=${TH_BACKEND_PORT:-?}  frontend=${TH_FRONTEND_PORT:-?}  mongo-express=${TH_MONGO_EXPRESS_PORT:-any} (--profile tools)" >&2
fi

compose() {
  docker compose -f "$WT/docker-compose.yml" -f "$OVERLAY" "$@"
}

# The host port Docker published for each service of the stack that runs, as VAR=port lines.
# mongo-express is optional, so a stack without it has no line for it.
running_ports() {
  local var service port published
  while read -r var service port; do
    if published="$(compose --profile tools port "$service" "$port" 2>/dev/null)" && [ -n "$published" ]; then
      published="${published%%$'\n'*}"
      echo "$var=${published##*:}"
    fi
  done <<'PORTS'
TH_MONGO_PORT mongodb 27017
TH_BACKEND_PORT backend 5000
TH_FRONTEND_PORT frontend 5173
TH_MONGO_EXPRESS_PORT mongo-express 8081
PORTS
}

# The compose subcommand: the first argument that is neither a global option nor an option's value.
subcommand() {
  while [ $# -gt 0 ]; do
    case "$1" in
      -f | --file | -p | --project-name | --profile | --env-file | --project-directory | --ansi | --progress | --parallel)
        shift 2 || shift
        ;;
      -*) shift ;;
      *)
        echo "$1"
        return
        ;;
    esac
  done
}

# Build each shared image that no image has the tag of yet.
ensure_images() {
  local image service
  for image in "conventioner/backend:$TH_BACKEND_TAG" "conventioner/frontend:$TH_FRONTEND_TAG"; do
    if ! docker image inspect "$image" >/dev/null 2>&1; then
      echo "th-compose: building $image, as no image has its tag yet" >&2
      service="${image#conventioner/}"
      compose build "${service%%:*}"
    fi
  done
}

if [ "${1:-}" = ports ]; then
  ports="$(running_ports)"
  for service in TH_MONGO_PORT:mongodb TH_BACKEND_PORT:backend TH_FRONTEND_PORT:frontend; do
    if ! grep -q "^${service%%:*}=" <<<"$ports"; then
      echo "th-compose: $COMPOSE_PROJECT_NAME's ${service#*:} is not running; start the stack with 'th-compose.sh up -d'." >&2
      exit 1
    fi
  done
  echo "export COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME"
  while read -r line; do echo "export $line"; done <<<"$ports"
  exit 0
fi

if [ "${1:-}" = ensure-images ]; then
  ensure_images
  exit 0
fi

SUBCOMMAND="$(subcommand "$@")"
case "$SUBCOMMAND" in
  up | create | run) ensure_images ;;
esac

if [ "${TH_PORTS:-}" = auto ] && [ "$SUBCOMMAND" = up ]; then
  compose "$@"
  running_ports >&2
  exit 0
fi

exec docker compose -f "$WT/docker-compose.yml" -f "$OVERLAY" "$@"
