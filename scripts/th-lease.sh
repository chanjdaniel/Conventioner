#!/usr/bin/env bash
#
# Acquire a pre-warmed, isolated Conventioner worktree for an agent and print
# its absolute path on stdout. Everything else goes to stderr, so agents can do:
#
#     path=$(scripts/th-lease.sh my-agent-label)
#     cd "$path" && <do work>
#     scripts/th-return.sh "$path"    # or: treehouse return "$path"
#
# Wraps `treehouse get --lease` (v2.0.0 does not run post_create hooks, so the
# pre-warm is driven here instead). The lease means the tree is never handed to
# another agent or pruned until you return it.
#
set -euo pipefail

REPO="/home/danielc/Documents/projects/personal/Conventioner"
HOLDER="${1:-${TREEHOUSE_LEASE_HOLDER:-agent}}"

# Lease a worktree (path -> stdout, banners -> stderr).
path="$(cd "$REPO" && treehouse get --lease --lease-holder "$HOLDER")"

# Pre-warm it (idempotent; fast on pool hits). Progress -> stderr.
TREEHOUSE_DIR="$path" "$REPO/scripts/treehouse-setup.sh" 1>&2

# Only the path on stdout.
echo "$path"
