#!/usr/bin/env bash
#
# Acquire a pre-warmed, isolated Conventioner worktree for an agent and print
# its absolute path on stdout. Everything else goes to stderr, so agents can do:
#
#     path=$(scripts/th-lease.sh my-agent-label)
#     cd "$path" && <do work>
#     scripts/th-return.sh "$path"    # or: treehouse return "$path"
#
# Wraps `treehouse get --lease` (treehouse v3 runs hooks only from the user's
# ~/.config/treehouse/config.toml, never from this repository, so the pre-warm is
# driven here instead). The lease means the tree is never handed to another agent
# or pruned until you return it.
#
set -euo pipefail

# Repo root = parent of this script's dir, so this works from any clone location.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOLDER="${1:-${TREEHOUSE_LEASE_HOLDER:-agent}}"

# Lease a worktree (path -> stdout, banners -> stderr).
path="$(cd "$REPO" && treehouse get --lease --lease-holder "$HOLDER")"

# Pre-warm it with the slot's own treehouse-setup.sh: the slot is cut from the latest base branch,
# while this script runs from the checkout that called it (often the primary), which may be behind
# and so hold an older pre-warm. A slot with no setup script of its own falls back to the caller's.
setup="$path/scripts/treehouse-setup.sh"
if [ ! -x "$setup" ]; then
  echo "[treehouse] WARNING: $path has no scripts/treehouse-setup.sh of its own; pre-warming it with $REPO/scripts/treehouse-setup.sh" >&2
  setup="$REPO/scripts/treehouse-setup.sh"
fi

# Idempotent; fast on pool hits. Progress -> stderr. A pre-warm hiccup must not lose the lease
# path - warn but still return it.
if ! TREEHOUSE_DIR="$path" "$setup" 1>&2; then
  echo "[treehouse] WARNING: pre-warm reported an error; worktree is leased at $path" >&2
fi

# Only the path on stdout.
echo "$path"
