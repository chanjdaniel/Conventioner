#!/usr/bin/env bash
#
# Print the tag of each image a worktree or gate stack runs, as TH_BACKEND_TAG= and TH_FRONTEND_TAG=
# lines: a short hash of the files the image is built from, so every stack with the same
# dependencies shares one image, and a change to the source alone, which reaches the containers
# through their bind mounts, needs no build.
#
# Usage: scripts/image-tags.sh [<worktree>]   (default: $TH_DIR, else the current directory)
#
# th-compose.sh exports these for the worktree overlay, which names the images
# conventioner/backend:<tag> and conventioner/frontend:<tag>.
#
set -euo pipefail

WT="${1:-${TH_DIR:-$PWD}}"

if command -v sha256sum >/dev/null; then
  sha() { sha256sum "$@"; }
else
  sha() { shasum -a 256 "$@"; } # macOS
fi

# The hash of each input file's name and content, in a fixed order, first 12 hex digits.
tag() {
  local input sums
  for input in "$@"; do
    if [[ ! -f "$WT/$input" ]]; then
      echo "image-tags: $WT/$input is missing; it is one of the files an image is built from." >&2
      exit 1
    fi
  done
  sums="$(cd "$WT" && sha "$@")"
  sums="$(sha <<<"$sums")"
  echo "${sums:0:12}"
}

backend="$(tag back-end/Dockerfile back-end/docker-entrypoint.sh back-end/requirements.txt back-end/requirements-floorplan-solver.txt)"
frontend="$(tag front-end/Dockerfile front-end/package.json front-end/package-lock.json)"
echo "TH_BACKEND_TAG=$backend"
echo "TH_FRONTEND_TAG=$frontend"
