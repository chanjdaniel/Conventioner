#!/usr/bin/env bash
#
# Return a leased Conventioner worktree to the pool. The tree (with its warm
# node_modules) stays in the pool for instant reuse; only the lease is released.
#
# Before releasing, we tear down any per-worktree docker-compose stack this
# worktree may have started (via th-compose.sh), so its offset ports/containers
# don't linger and collide when the slot is reused.
#
#     scripts/th-return.sh <worktree-path>
#     scripts/th-return.sh <worktree-path> --force   # no prompts
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WT="${1:-}"

# Best-effort docker teardown (only if a worktree path was given and it looks
# like a treehouse worktree with a compose file).
if [ -n "$WT" ] && [ -f "$WT/docker-compose.yml" ] && command -v docker >/dev/null 2>&1; then
  if ! TH_DIR="$WT" "$REPO/scripts/th-compose.sh" down -v --remove-orphans >/dev/null 2>&1; then
    echo "[treehouse] WARNING: docker teardown failed for $WT — lingering containers may hold offset ports" >&2
  fi
fi

treehouse return "$@"
