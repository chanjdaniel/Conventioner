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

# Repo root = parent of this script's dir, so this works from any clone location.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOLDER="${1:-${TREEHOUSE_LEASE_HOLDER:-agent}}"

# Lease a worktree (path -> stdout, banners -> stderr).
path="$(cd "$REPO" && treehouse get --lease --lease-holder "$HOLDER")"

# Pre-warm it (idempotent; fast on pool hits). Progress -> stderr. A pre-warm
# hiccup must not lose the lease path — warn but still return it.
if ! TREEHOUSE_DIR="$path" "$REPO/scripts/treehouse-setup.sh" 1>&2; then
  echo "[treehouse] WARNING: pre-warm reported an error; worktree is leased at $path" >&2
fi

# Only the path on stdout.
echo "$path"
