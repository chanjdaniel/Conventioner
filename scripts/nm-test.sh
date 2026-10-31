#!/usr/bin/env bash
#
# Deterministic full-suite test runner; the no-mistakes gate runs it with --skip-e2e.
#
# Runs its E2E stack under a project name of its own, on host ports Docker picks,
# so it runs safely alongside the primary stack and other runs, and takes turns with other runs for
# its E2E phase (see the lock). Tears the stack down and removes its virtual environment however the
# run ends: an EXIT trap, and guards that outlive a SIGKILL (see Teardown).
#
# Usage:
#     ./scripts/nm-test.sh
#     ./scripts/nm-test.sh --skip-e2e
#     PYTHON_CMD=/path/to/python3.12 ./scripts/nm-test.sh
#
# --skip-e2e runs every suite but Playwright, and so starts no stack and takes no end-to-end lock:
# the gate passes it, leaving Playwright to CI's required e2e shards
# (docs/implementation/testing/ci-and-the-gate.md).
#
# Requires: Docker (not with --skip-e2e), Node.js 24.22.1 (.nvmrc), Python 3.12 (back-end/.python-version; or set PYTHON_CMD).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
RUN_ID="nmtest-$$"

fail() { echo "nm-test: ERROR: $*" >&2; exit 1; }

E2E=run
for arg in "$@"; do
  case "$arg" in
    --skip-e2e) E2E=skip ;;
    *) fail "unknown argument: $arg (usage: nm-test.sh [--skip-e2e])" ;;
  esac
done

PYTHON="${PYTHON_CMD:-python3.12}"
if ! command -v "$PYTHON" &>/dev/null; then
  PYTHON=python3
fi
if ! command -v "$PYTHON" &>/dev/null; then
  fail "Python not found on PATH. Install Python 3.12 or set PYTHON_CMD."
fi

# ── Real data (before anything else) ─────────────────────────────────────────

# The gate pushes the branch to GitHub, and the repository is public, so the branch's commits are
# checked for a real person's details before anything runs (the git hooks run the same check), and
# then the whole tree at HEAD, so a name listed since a file was committed is found too.
cd "$REPO_ROOT"
echo "nm-test: checking the branch's commits since origin/dev for real data..."
"$PYTHON" "$SCRIPT_DIR/real_data_check.py" commits HEAD --not origin/dev
echo "nm-test: checking the whole tree for real data..."
"$PYTHON" "$SCRIPT_DIR/real_data_check.py" tree
echo "Real data: OK"

# ── Stack identity ───────────────────────────────────────────────────────────

# Docker assigns every host port as the stack starts (th-compose.sh's auto mode), so two runs can
# never race for one port; the E2E phase reads them back once the stack is up.
export COMPOSE_PROJECT_NAME="$RUN_ID" TH_PORTS=auto TH_DIR="$REPO_ROOT"
unset TH_MONGO_PORT TH_BACKEND_PORT TH_FRONTEND_PORT TH_MONGO_EXPRESS_PORT

# The team's labels, which the overlay puts on every container, volume and network of the stack,
# so whatever is left of it says what it is (docs/implementation/testing/ci-and-the-gate.md).
# TEAM_KIND=gate is the value the team's reaper knows, kept although the gate passes --skip-e2e
# and so starts no stack: only a run without it does. A run is the team's only when the team
# started it, which it says by setting TEAM_TASK.
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

if [[ "$E2E" == run ]]; then
  echo "nm-test: project=$COMPOSE_PROJECT_NAME"
fi

# ── Teardown ─────────────────────────────────────────────────────────────────

STACK_LOG_DIR="$REPO_ROOT/.stack-logs"
GUARD_LOG="$STACK_LOG_DIR/$COMPOSE_PROJECT_NAME-guard.log"

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
}
if [[ "$E2E" == run ]]; then
  trap cleanup EXIT
fi

# The trap above is set only when the run starts a stack (not with --skip-e2e). It runs on a normal
# exit and on SIGTERM, but the gate aborts a run by sending SIGTERM and then SIGKILL to this
# script's whole process group: the SIGKILL kills the trap's own docker commands, and nothing at
# all runs after a SIGKILL to this script. So the stack's teardown also rests on a guard in a
# process group of its own, which outlives this script, waits for it to be gone, and removes
# whatever of the stack is left. It needs no compose file, since the gate may be deleting this
# worktree by then. After a normal exit it finds nothing left and exits. Another guard removes the
# run's virtual environment, from the moment it exists.
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

# Runs "$@" once this run is gone, in a guard writing to the guard log.
after_run() {
  local run=$$
  mkdir -p "$STACK_LOG_DIR"
  set -m # job control: the guard gets a process group of its own
  (
    trap - EXIT
    set +e
    cd /
    echo "nm-test guard: watching run $run to run: $*"
    while alive "$run"; do sleep 1; done
    echo "nm-test guard: run $run is gone; running: $*"
    "$@"
  ) </dev/null >>"$GUARD_LOG" 2>&1 &
  set +m
}

remove_stack() {
  local project=$1 left
  for _ in 1 2 3; do
    docker compose -p "$project" down -v --remove-orphans --timeout 5
    left="$(leftovers "$project" | tr '\n' ' ')"
    [[ -z "$left" ]] && return 0
    sleep 5
  done
  echo "nm-test guard: ERROR: $project still has: $left" >&2
  return 1
}

start_teardown_guard() {
  after_run remove_stack "$COMPOSE_PROJECT_NAME"
  echo "nm-test: teardown guard $! watches this run"
}

echo "nm-test: Python $($PYTHON --version)"

# Install into a virtual environment of the run's own, never into that Python: a uv- or
# distro-managed interpreter refuses `pip install` outright (PEP 668), and one that accepts it
# would keep whatever this run installed. A guard deletes it once the run is gone, however it ends.
VENV_DIR="$(mktemp -d "${TMPDIR:-/tmp}/$RUN_ID-venv.XXXXXX")"
after_run rm -rf "$VENV_DIR"
"$PYTHON" -m venv "$VENV_DIR"
PYTHON="$VENV_DIR/bin/python"
$PYTHON -m pip install -q --disable-pip-version-check --upgrade pip

# ── Knowledge graph (hermetic, no stack) ─────────────────────────────────────

echo ""
echo "===== Knowledge Graph ====="

cd "$REPO_ROOT"
$PYTHON -m pip install -q -r back-end/requirements-dev.txt
$PYTHON -m pytest scripts/tests -q
$PYTHON scripts/knowledge_graph.py check
echo "Knowledge graph: OK"

# ── Backend tests (hermetic, no stack) ───────────────────────────────────────

echo ""
echo "===== Backend Tests ====="

cd "$REPO_ROOT/back-end"
$PYTHON -m pip install -q -r requirements.txt -r requirements-floorplan-solver.txt -r requirements-dev.txt
# As CI does: re-lock (the dev lock just installed uv, which the script needs) and fail on any
# difference, which is how a lock edited by hand is caught.
PATH="$VENV_DIR/bin:$PATH" "$REPO_ROOT/scripts/lock-backend-requirements.sh"
git diff --exit-code -- 'requirements*.txt'
$PYTHON -m pytest tests/ -v
echo "Backend tests: OK"

# ── Frontend unit tests (hermetic) ───────────────────────────────────────────

echo ""
echo "===== Frontend Unit Tests ====="

cd "$REPO_ROOT/front-end"
npm ci
npm run test:unit
echo "Frontend unit tests: OK"

# ── Bundle budget (hermetic) ─────────────────────────────────────────────────

echo ""
echo "===== Bundle Budget ====="

# As CI's frontend-lint-and-types does: the entry JavaScript of a build with no captcha site key,
# measured and never deployed (front-end/scripts/bundle-budget.ts).
VITE_ALLOW_INSECURE_LOCAL_DEV=true npm run build-only
npm run bundle-budget
echo "Bundle budget: OK"
# As CI does next: that build calls neither eval nor Function (front-end/scripts/no-eval.ts).
npm run no-eval

# ── E2E tests (needs the stack) ──────────────────────────────────────────────

echo ""
if [[ "$E2E" == skip ]]; then
  echo "nm-test: --skip-e2e: Playwright is left to CI's e2e shards; no stack started."
  echo ""
  echo "===== All tests passed ====="
  exit 0
fi
echo "===== E2E Tests ====="

echo "nm-test: installing Playwright browsers..."
# Never --with-deps or install-deps: they run sudo, which fails without a
# terminal and counts toward the account's lockout. The machine's own package
# manager provides the system libraries.
npx playwright install chromium

# Match CI's e2e job env
export DISABLE_CAPTCHA=true
export DISABLE_EMAIL=true
export DISCORD_FAKE=true

cd "$REPO_ROOT"
# The images every run with the same dependencies shares: built only when none has their tag yet.
"$REPO_ROOT/scripts/th-compose.sh" ensure-images

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
