#!/usr/bin/env bash
#
# Return a leased Conventioner worktree to the pool. The tree (with its warm
# node_modules) stays in the pool for instant reuse; only the lease is released.
#
# Before releasing, we tear down the worktree's own docker-compose stack (the
# slot's, via th-compose.sh), so its offset ports/containers and its database
# don't linger into the next lease. A teardown that fails is reported with its
# own error output, and the lease is kept (exit 1) unless --force is given, in
# which case the lease is returned anyway.
#
#     scripts/th-return.sh <worktree-path>
#     scripts/th-return.sh <worktree-path> --force   # no prompts; return even if the teardown failed
#
# The last step is `treehouse return`, whose exit status is this script's: treehouse v3
# exits 3 when it leaves a dirty worktree leased.
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WT="" FORCE=""
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -*) ;;
    *) [ -n "$WT" ] || WT="$arg" ;;
  esac
done

# Tear down only if a worktree path was given and it looks like a treehouse worktree with a
# compose file. The slot's identity comes from its path alone: a stack identity the caller's
# shell exported (`eval "$(th-compose.sh ports)"` for another stack) must not redirect it.
# The teardown is the slot's own th-compose.sh, whose overlay is the one beside the slot's compose
# file; this script runs from the checkout that called it (often the primary), which may be behind.
if [ -n "$WT" ] && [ -f "$WT/docker-compose.yml" ] && command -v docker >/dev/null 2>&1; then
  compose="$WT/scripts/th-compose.sh"
  if [ ! -x "$compose" ]; then
    echo "th-return: $WT has no scripts/th-compose.sh of its own; tearing it down with $REPO/scripts/th-compose.sh" >&2
    compose="$REPO/scripts/th-compose.sh"
  fi
  if ! err="$(env -u COMPOSE_PROJECT_NAME -u TH_PORTS -u TH_MONGO_PORT -u TH_BACKEND_PORT \
    -u TH_FRONTEND_PORT -u TH_MONGO_EXPRESS_PORT TH_DIR="$WT" \
    "$compose" down -v --remove-orphans 2>&1 >/dev/null)"; then
    printf '%s\n' "$err" >&2
    if [ -z "$FORCE" ]; then
      echo "th-return: teardown failed for $WT; the lease is kept (use --force to return it anyway)" >&2
      exit 1
    fi
    echo "th-return: teardown failed for $WT; returning the lease anyway (--force)" >&2
  fi
fi

treehouse return "$@"
