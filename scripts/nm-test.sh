#!/usr/bin/env bash
#
# Deterministic full-suite test runner for the no-mistakes gate.
#
# Runs its E2E stack under a project name of its own, on host ports Docker picks,
# so it runs safely alongside the primary stack and other runs, and takes turns with other runs for
# its E2E phase (see the lock). Tears the stack down however the run ends: an EXIT trap, and a
# guard that outlives a SIGKILL (see Teardown).
#
# Usage:
#     ./scripts/nm-test.sh
#     PYTHON_CMD=/path/to/python3.12 ./scripts/nm-test.sh
#
# Requires: Docker, Node.js 20+, Python 3.12 (back-end/.python-version; or set PYTHON_CMD).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
RUN_ID="nmtest-$$"

fail() { echo "nm-test: ERROR: $*" >&2; exit 1; }

PYTHON="${PYTHON_CMD:-python3.12}"
if ! command -v "$PYTHON" &>/dev/null; then
  PYTHON=python3
fi
if ! command -v "$PYTHON" &>/dev/null; then
  fail "Python not found on PATH. Install Python 3.12 or set PYTHON_CMD."
fi

# ── Stack identity ───────────────────────────────────────────────────────────

# Docker assigns every host port as the stack starts (th-compose.sh's auto mode), so two runs can
# never race for one port; the E2E phase reads them back once the stack is up.
export COMPOSE_PROJECT_NAME="$RUN_ID" TH_PORTS=auto TH_DIR="$REPO_ROOT"
unset TH_MONGO_PORT TH_BACKEND_PORT TH_FRONTEND_PORT TH_MONGO_EXPRESS_PORT

# The team's labels, which the overlay puts on every container, volume and network of the stack,
# so whatever is left of it says what it is (docs/implementation/testing/ci-and-the-gate.md).
# A gate run is the team's only when the team started it, which it says by setting TEAM_TASK.
export TEAM_KIND=gate
export TEAM_WORKTREE="$REPO_ROOT"
if [[ -n "${TEAM_TASK:-}" ]]; then
  export TEAM_OWNER=agent-team
else
  unset TEAM_OWNER
fi
# After this the reaper may remove the stack, should both teardowns below have failed.
TEAM_EXPIRES="$("$PYTHON" -c 'import datetime as d; print((d.datetime.now(d.timezone.utc) + d.timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ"))')"
export TEAM_EXPIRES

echo "nm-test: project=$COMPOSE_PROJECT_NAME"

# ── Teardown ─────────────────────────────────────────────────────────────────

STACK_LOG_DIR="$REPO_ROOT/.stack-logs"

cleanup() {
  echo ""
  # Capture the stack's logs BEFORE tearing it down. `down -v` destroys them, and a failure that
  # only happens under a full-suite run is exactly the one whose logs you cannot get afterwards -
  # which is why E06/F01/S02 went undiagnosed through several attempts.
  mkdir -p "$STACK_LOG_DIR"
  for service in backend frontend; do
    "$SCRIPT_DIR/th-compose.sh" logs --no-color --timestamps "$service" \
      > "$STACK_LOG_DIR/$COMPOSE_PROJECT_NAME-$service.log" 2>&1 || true
  done
  echo "nm-test: stack logs in $STACK_LOG_DIR/"

  echo "nm-test: tearing down stack..."
  if "$SCRIPT_DIR/th-compose.sh" down -v --remove-orphans; then
    echo "nm-test: stack torn down."
  else
    echo "nm-test: ERROR: tearing down $COMPOSE_PROJECT_NAME failed (above); the teardown guard retries it." >&2
  fi
  if [[ -n "${VENV_DIR:-}" ]]; then
    rm -rf "$VENV_DIR"
  fi
}
trap cleanup EXIT

# The trap above runs on a normal exit and on SIGTERM, but the gate aborts a run by sending SIGTERM
# and then SIGKILL to this script's whole process group: the SIGKILL kills the trap's own docker
# commands, and nothing at all runs after a SIGKILL to this script. So the stack's teardown also
# rests on a guard in a process group of its own, which outlives this script, waits for it to be
# gone, and removes whatever of the stack is left. It needs no compose file, since the gate may be
# deleting this worktree by then. After a normal exit it finds nothing left and exits.
alive() {
  local state
  state="$(ps -o stat= -p "$1" 2>/dev/null)" || return 1
  [[ "${state//[[:space:]]/}" != Z* ]]
}

leftovers() {
  local filter="label=com.docker.compose.project=$1"
  docker container ls -aq --filter "$filter"
  docker volume ls -q --filter "$filter"
  docker network ls -q --filter "$filter"
}

start_teardown_guard() {
  local run=$$ project=$COMPOSE_PROJECT_NAME
  mkdir -p "$STACK_LOG_DIR"
  set -m # job control: the guard gets a process group of its own
  (
    trap - EXIT
    set +e
    cd /
    echo "nm-test guard: watching run $run for $project"
    while alive "$run"; do sleep 1; done
    echo "nm-test guard: run $run is gone; removing what is left of $project"
    for _ in 1 2 3; do
      docker compose -p "$project" down -v --remove-orphans --timeout 5
      left="$(leftovers "$project" | tr '\n' ' ')"
      [[ -z "$left" ]] && exit 0
      sleep 5
    done
    echo "nm-test guard: ERROR: $project still has: $left" >&2
    exit 1
  ) </dev/null >>"$STACK_LOG_DIR/$COMPOSE_PROJECT_NAME-guard.log" 2>&1 &
  set +m
  echo "nm-test: teardown guard $! watches this run"
}

echo "nm-test: Python $($PYTHON --version)"

# Install into a virtual environment of the run's own, never into that Python: a uv- or
# distro-managed interpreter refuses `pip install` outright (PEP 668), and one that accepts it
# would keep whatever this run installed. The trap deletes it.
VENV_DIR="$(mktemp -d "${TMPDIR:-/tmp}/$RUN_ID-venv.XXXXXX")"
"$PYTHON" -m venv "$VENV_DIR"
PYTHON="$VENV_DIR/bin/python"
$PYTHON -m pip install -q --disable-pip-version-check --upgrade pip

# ── Knowledge graph (hermetic, no stack) ─────────────────────────────────────

echo ""
echo "===== Knowledge Graph ====="

cd "$REPO_ROOT"
$PYTHON -m pip install -q pytest
$PYTHON -m pytest scripts/tests -q
$PYTHON scripts/knowledge_graph.py check
echo "Knowledge graph: OK"

# ── Backend tests (hermetic, no stack) ───────────────────────────────────────

echo ""
echo "===== Backend Tests ====="

cd "$REPO_ROOT/back-end"
$PYTHON -m pip install -q -r requirements.txt -r requirements-floorplan-solver.txt -r requirements-dev.txt
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
# Never --with-deps or install-deps: they run sudo, which fails without a
# terminal and counts toward the account's lockout. The machine's own package
# manager provides the system libraries.
npx playwright install chromium

# Match CI's e2e job env
export DISABLE_CAPTCHA=true
export DISABLE_EMAIL=true

cd "$REPO_ROOT"
"$REPO_ROOT/scripts/th-compose.sh" build

# One E2E phase at a time on this machine, from the stack's start to its teardown: a stack starting
# or stopping breaks another run's browser with net::ERR_NETWORK_CHANGED. The teardown guard
# inherits the lock, so a killed run keeps it until its stack is down; every other command runs
# without it. T19's ticket 11 replaces this with `team-capacity run --kind gate:conventioner`,
# keeping the lock as the fallback when team-capacity is absent.
# shellcheck source=scripts/e2e-lock.sh
source "$SCRIPT_DIR/e2e-lock.sh"
take_e2e_lock $((45 * 60)) "$COMPOSE_PROJECT_NAME (pid $$, $REPO_ROOT)"
start_teardown_guard

without_e2e_lock "$REPO_ROOT/scripts/th-compose.sh" up -d
# seed_fixture.sh and Playwright find the stack by the project and ports this exports.
STACK_ENV="$(without_e2e_lock "$REPO_ROOT/scripts/th-compose.sh" ports)"
eval "$STACK_ENV"
echo "nm-test: ports mongo=$TH_MONGO_PORT backend=$TH_BACKEND_PORT frontend=$TH_FRONTEND_PORT"
without_e2e_lock "$REPO_ROOT/scripts/seed_fixture.sh"

cd "$REPO_ROOT/front-end"
without_e2e_lock npx playwright test
echo "E2E tests: OK"

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo "===== All tests passed ====="
