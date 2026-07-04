#!/usr/bin/env bash
#
# Return a leased Conventioner worktree to the pool. The tree (with its warm
# node_modules and venv) stays in the pool for instant reuse; only the lease is
# released and lingering processes are terminated.
#
#     scripts/th-return.sh <worktree-path>
#     scripts/th-return.sh <worktree-path> --force   # no prompts
#
set -euo pipefail
treehouse return "$@"
