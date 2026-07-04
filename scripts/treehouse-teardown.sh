#!/usr/bin/env bash
#
# treehouse pre_destroy hook — best-effort cleanup before a worktree is removed.
# Must never fail (a nonzero exit would block the destroy), so everything is
# guarded and the script always exits 0.
#
WORKTREE="${TREEHOUSE_DIR:-$PWD}"
cd "$WORKTREE" 2>/dev/null || exit 0

# If this worktree ever brought up a docker-compose stack (project name defaults
# to the worktree dir name), tear it down so containers/volumes don't linger.
if command -v docker >/dev/null 2>&1 && [ -f "$WORKTREE/docker-compose.yml" ]; then
  docker compose -f "$WORKTREE/docker-compose.yml" down -v --remove-orphans >/dev/null 2>&1 || true
fi

echo "[treehouse] teardown: $WORKTREE"
exit 0
