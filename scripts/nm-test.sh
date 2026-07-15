#!/usr/bin/env bash
#
# Deterministic full-suite test runner for the no-mistakes gate.
#
# Computes a unique, collision-free stack identity (project name + 4 free ports)
# so it runs safely alongside the primary stack. Guarantees teardown via trap.
#
# Usage:
#     ./scripts/nm-test.sh
#     PYTHON_CMD=/path/to/python3.11 ./scripts/nm-test.sh
#
# Requires: Docker, Node.js 20+, Python 3.11+ (or set PYTHON_CMD).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
RUN_ID="nmtest-$$"

fail() { echo "nm-test: ERROR: $*" >&2; exit 1; }

# ── Port discovery ───────────────────────────────────────────────────────────

find_free_port() {
  if command -v python3 &>/dev/null; then
    python3 -c "import socket; s=socket.socket(); s.bind(('',0)); print(s.getsockname()[1]); s.close()"
  else
    local port
    while true; do
      port=$((10000 + RANDOM % 50000))
      if ! ss -tlnp 2>/dev/null | grep -q ":${port} "; then
        echo "$port"; return 0
      fi
    done
  fi
}

# ── Stack identity ───────────────────────────────────────────────────────────

COMPOSE_PROJECT_NAME="$RUN_ID"
TH_MONGO_PORT="$(find_free_port)"
TH_BACKEND_PORT="$(find_free_port)"
TH_FRONTEND_PORT="$(find_free_port)"
TH_MONGO_EXPRESS_PORT="$(find_free_port)"
export COMPOSE_PROJECT_NAME TH_MONGO_PORT TH_BACKEND_PORT TH_FRONTEND_PORT TH_MONGO_EXPRESS_PORT

echo "nm-test: project=$COMPOSE_PROJECT_NAME"
echo "nm-test: ports mongo=$TH_MONGO_PORT backend=$TH_BACKEND_PORT frontend=$TH_FRONTEND_PORT mongo-express=$TH_MONGO_EXPRESS_PORT"

# ── Teardown ─────────────────────────────────────────────────────────────────

cleanup() {
  echo ""
  echo "nm-test: tearing down stack..."
  docker compose \
    -f "$REPO_ROOT/docker-compose.yml" \
    -f "$REPO_ROOT/docker-compose.worktree.yml" \
    -p "$COMPOSE_PROJECT_NAME" \
    down -v 2>/dev/null || true
  echo "nm-test: stack torn down."
}
trap cleanup EXIT

# ── Backend tests (hermetic, no stack) ───────────────────────────────────────

echo ""
echo "===== Backend Tests ====="

PYTHON="${PYTHON_CMD:-python3.11}"
if ! command -v "$PYTHON" &>/dev/null; then
  PYTHON=python3
fi
if ! command -v "$PYTHON" &>/dev/null; then
  fail "Python not found on PATH. Install Python 3.11+ or set PYTHON_CMD."
fi
echo "nm-test: Python $($PYTHON --version)"

cd "$REPO_ROOT/back-end"
$PYTHON -m pip install -q -r requirements.txt -r requirements-dev.txt
$PYTHON -m pytest tests/ -v
echo "Backend tests: OK"

# ── Frontend unit tests (hermetic) ───────────────────────────────────────────

echo ""
echo "===== Frontend Unit Tests ====="

cd "$REPO_ROOT/front-end"
npm ci
npm run test:unit
echo "Frontend unit tests: OK"

# ── E2E tests (needs the stack) ──────────────────────────────────────────────

echo ""
echo "===== E2E Tests ====="

echo "nm-test: installing Playwright browsers..."
npx playwright install chromium --with-deps 2>/dev/null || npx playwright install chromium

# Match CI's e2e job env
export DISABLE_CAPTCHA=true
export DISABLE_EMAIL=true

cd "$REPO_ROOT"
"$REPO_ROOT/scripts/th-compose.sh" build
"$REPO_ROOT/scripts/th-compose.sh" up -d
"$REPO_ROOT/scripts/seed_fixture.sh"

cd "$REPO_ROOT/front-end"
npx playwright test
echo "E2E tests: OK"

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo "===== All tests passed ====="
