#!/usr/bin/env bash
#
# Compile the back end's requirements locks from the .in files beside them: every package, direct
# or not, one exact version with its hashes, so a rebuild of unchanged code installs exactly what
# was tested. Vercel, Docker, CI and the gate install the .txt locks; people edit only the .in files.
#
# Usage: scripts/lock-backend-requirements.sh [uv pip compile options]
#   no options                          keep every pin; add or drop only what the .in files changed
#   --upgrade-package <name>[==<ver>]   move one package (and what it needs) on purpose
#   --upgrade                           move everything to the newest versions that resolve
#
# Needs uv (https://docs.astral.sh/uv/). The locks are universal (every platform, for the Python in
# back-end/.python-version), so the hashes cover Vercel's Amazon Linux, Docker's Debian and CI's
# Ubuntu alike. The floorplan solver's and the dev locks are constrained by requirements.txt, so a
# package that appears in two locks has the same pin in both and they install together.
#
set -euo pipefail

cd "$(dirname "$0")/../back-end"

if ! command -v uv >/dev/null; then
  echo "lock-backend-requirements: needs uv; see https://docs.astral.sh/uv/getting-started/installation/" >&2
  exit 1
fi

lock() {
  uv pip compile --quiet --universal --generate-hashes \
    --python-version "$(cat .python-version)" \
    --custom-compile-command "scripts/lock-backend-requirements.sh" \
    "$@"
}

lock requirements.in -o requirements.txt "$@"
lock requirements-floorplan-solver.in -c requirements.txt -o requirements-floorplan-solver.txt "$@"
lock requirements-dev.in -c requirements.txt -o requirements-dev.txt "$@"
