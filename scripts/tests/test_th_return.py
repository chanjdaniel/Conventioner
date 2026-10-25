"""th-return.sh run for real, with stub `docker` and `treehouse` executables first on PATH that record what they were asked to do."""

import os
import shutil
import subprocess
from pathlib import Path

import pytest
from build_inputs import copy_build_inputs
from stacks import slot_path

REPO = Path(__file__).resolve().parents[2]
RETURN = REPO / "scripts" / "th-return.sh"

# A stub docker that logs its arguments with the project compose would act on, and fails a
# `compose ... down` as Docker does when $DOWN_FAILS is set.
DOCKER_STUB = """#!/usr/bin/env bash
printf '%s | project=%s\\n' "$*" "${COMPOSE_PROJECT_NAME-unset}" >> "$DOCKER_LOG"
if [ "$1" = compose ] && [ -n "${DOWN_FAILS:-}" ]; then
  for arg in "$@"; do
    if [ "$arg" = down ]; then
      echo "Error response from daemon: container 4f2a is in use and cannot be removed" >&2
      exit 1
    fi
  done
fi
exit 0
"""

# A stub treehouse that logs its arguments and exits $TREEHOUSE_STATUS (0 by default).
TREEHOUSE_STUB = """#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$TREEHOUSE_LOG"
exit "${TREEHOUSE_STATUS:-0}"
"""

# A stub of the slot's own th-compose.sh that logs its arguments and the worktree it was pointed at.
SLOT_WRAPPER_STUB = """#!/usr/bin/env bash
printf 'slot %s | TH_DIR=%s\\n' "$*" "$TH_DIR" >> "$DOCKER_LOG"
"""


@pytest.fixture
def bin_dir(tmp_path):
    """The stubs' directory, to put first on PATH."""
    stubs = tmp_path / "bin"
    stubs.mkdir()
    for name, body in (("docker", DOCKER_STUB), ("treehouse", TREEHOUSE_STUB)):
        (stubs / name).write_text(body)
        (stubs / name).chmod(0o755)
    return stubs


# The files the slot's own teardown runs, beside its compose file.
TEARDOWN_FILES = ("docker-compose.yml", "docker-compose.worktree.yml", "scripts/th-compose.sh", "scripts/image-tags.sh")


@pytest.fixture
def slot(tmp_path):
    worktree = slot_path(tmp_path, 3)
    for name in TEARDOWN_FILES:
        (worktree / name).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(REPO / name, worktree / name)
    return copy_build_inputs(worktree)


def run_return(bin_dir, *args, **extra):
    env = {k: v for k, v in os.environ.items() if not k.startswith(("COMPOSE_", "TH_", "TEAM_"))}
    env.update(
        PATH=f"{bin_dir}{os.pathsep}{env['PATH']}",
        DOCKER_LOG=str(bin_dir.parent / "docker.log"),
        TREEHOUSE_LOG=str(bin_dir.parent / "treehouse.log"),
    )
    env.update(extra)
    return subprocess.run([str(RETURN), *map(str, args)], env=env, capture_output=True, text=True)


def docker_calls(bin_dir):
    log = bin_dir.parent / "docker.log"
    return log.read_text().splitlines() if log.exists() else []


def treehouse_calls(bin_dir):
    log = bin_dir.parent / "treehouse.log"
    return log.read_text().splitlines() if log.exists() else []


def teardowns(bin_dir):
    """Each compose call's arguments past the two compose files, with the project it acted on."""
    return [call.split(".yml ", 2)[-1] for call in docker_calls(bin_dir) if call.startswith("compose ")]


def test_a_failed_teardown_is_reported_and_keeps_the_lease(slot, bin_dir):
    result = run_return(bin_dir, slot, DOWN_FAILS="1")

    assert result.returncode == 1
    assert "Error response from daemon: container 4f2a is in use and cannot be removed" in result.stderr
    assert f"teardown failed for {slot}; the lease is kept (use --force to return it anyway)" in result.stderr
    assert teardowns(bin_dir) == ["down -v --remove-orphans | project=conventioner-3"]
    assert treehouse_calls(bin_dir) == []


def test_a_forced_return_reports_a_failed_teardown_and_returns_the_lease(slot, bin_dir):
    result = run_return(bin_dir, slot, "--force", DOWN_FAILS="1")

    assert result.returncode == 0, result.stderr
    assert "Error response from daemon: container 4f2a is in use and cannot be removed" in result.stderr
    assert f"teardown failed for {slot}; returning the lease anyway (--force)" in result.stderr
    assert treehouse_calls(bin_dir) == [f"return {slot} --force"]


def test_force_may_come_before_the_path(slot, bin_dir):
    result = run_return(bin_dir, "--force", slot, DOWN_FAILS="1")

    assert result.returncode == 0, result.stderr
    assert teardowns(bin_dir) == ["down -v --remove-orphans | project=conventioner-3"]
    assert f"teardown failed for {slot}; returning the lease anyway (--force)" in result.stderr
    assert treehouse_calls(bin_dir) == [f"return --force {slot}"]


def test_a_successful_teardown_returns_the_lease_quietly(slot, bin_dir):
    result = run_return(bin_dir, slot)

    assert result.returncode == 0, result.stderr
    assert teardowns(bin_dir) == ["down -v --remove-orphans | project=conventioner-3"]
    assert treehouse_calls(bin_dir) == [f"return {slot}"]
    assert result.stderr == ""


def test_a_worktree_with_no_compose_file_is_returned_without_a_teardown(tmp_path, bin_dir):
    worktree = slot_path(tmp_path, 3)
    worktree.mkdir(parents=True)

    result = run_return(bin_dir, worktree, DOWN_FAILS="1")

    assert result.returncode == 0, result.stderr
    assert docker_calls(bin_dir) == []
    assert treehouse_calls(bin_dir) == [f"return {worktree}"]


def test_the_teardown_is_the_slots_own_stack_whatever_the_shell_exported(slot, bin_dir):
    # `eval "$(th-compose.sh ports)"` for another stack leaves its identity in the shell.
    result = run_return(
        bin_dir,
        slot,
        COMPOSE_PROJECT_NAME="conventioner-3-e2e",
        TH_PORTS="auto",
        TH_MONGO_PORT="49153",
        TH_BACKEND_PORT="49154",
        TH_FRONTEND_PORT="49155",
    )

    assert result.returncode == 0, result.stderr
    assert teardowns(bin_dir) == ["down -v --remove-orphans | project=conventioner-3"]


def test_treehouse_returns_exit_status_is_passed_on(slot, bin_dir):
    # treehouse v3 exits 3 when it leaves a dirty worktree leased.
    result = run_return(bin_dir, slot, TREEHOUSE_STATUS="3")

    assert result.returncode == 3
    assert treehouse_calls(bin_dir) == [f"return {slot}"]


def test_the_teardown_is_the_slots_own_wrapper_not_the_callers(slot, bin_dir):
    # th-return.sh runs from the primary checkout, which may be behind the slot.
    wrapper = slot / "scripts" / "th-compose.sh"
    wrapper.write_text(SLOT_WRAPPER_STUB)

    result = run_return(bin_dir, slot)

    assert result.returncode == 0, result.stderr
    assert docker_calls(bin_dir) == [f"slot down -v --remove-orphans | TH_DIR={slot}"]
    assert treehouse_calls(bin_dir) == [f"return {slot}"]


def test_a_slot_with_no_wrapper_of_its_own_is_torn_down_by_the_callers_and_says_so(slot, bin_dir):
    (slot / "scripts" / "th-compose.sh").unlink()

    result = run_return(bin_dir, slot)

    assert result.returncode == 0, result.stderr
    assert (
        f"th-return: {slot} has no scripts/th-compose.sh of its own; tearing it down with {REPO}/scripts/th-compose.sh"
    ) in result.stderr
    assert teardowns(bin_dir) == ["down -v --remove-orphans | project=conventioner-3"]
    assert treehouse_calls(bin_dir) == [f"return {slot}"]
