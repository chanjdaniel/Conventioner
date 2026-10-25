"""th-lease.sh run for real from a stand-in for the primary checkout, with a stub `treehouse` first on PATH that
leases a slot cut from a newer commit, and stub pre-warms in both that log which one ran."""

import os
import shutil
import subprocess
from pathlib import Path

import pytest
from stacks import slot_path

REPO = Path(__file__).resolve().parents[2]
LEASE = REPO / "scripts" / "th-lease.sh"

# A stub treehouse that logs its arguments and the directory it ran in, and leases $SLOT.
TREEHOUSE_STUB = """#!/usr/bin/env bash
printf '%s | cwd=%s\\n' "$*" "$PWD" >> "$TREEHOUSE_LOG"
echo "Leased worktree at $SLOT." >&2
echo "$SLOT"
"""

# A stub pre-warm that logs whose it is ($1, baked in) and the worktree it was asked to warm, then exits
# $SETUP_STATUS (0 by default).
SETUP_STUB = """#!/usr/bin/env bash
printf '%s | %s\\n' "{owner}" "$TREEHOUSE_DIR" >> "$SETUP_LOG"
echo "[treehouse] ready: $TREEHOUSE_DIR"
exit "${{SETUP_STATUS:-0}}"
"""


def write_setup(checkout, owner):
    setup = checkout / "scripts" / "treehouse-setup.sh"
    setup.parent.mkdir(parents=True, exist_ok=True)
    setup.write_text(SETUP_STUB.format(owner=owner))
    setup.chmod(0o755)


@pytest.fixture
def bin_dir(tmp_path):
    stubs = tmp_path / "bin"
    stubs.mkdir()
    (stubs / "treehouse").write_text(TREEHOUSE_STUB)
    (stubs / "treehouse").chmod(0o755)
    return stubs


@pytest.fixture
def primary(tmp_path):
    """The checkout the lease runs from, as the team does: this branch's th-lease.sh beside an older pre-warm."""
    checkout = tmp_path / "Conventioner"
    (checkout / "scripts").mkdir(parents=True)
    shutil.copy(LEASE, checkout / "scripts" / "th-lease.sh")
    write_setup(checkout, "primary")
    return checkout


@pytest.fixture
def slot(tmp_path):
    """The leased slot, cut from the latest base branch, whose pre-warm differs from the primary's."""
    worktree = slot_path(tmp_path, 2)
    worktree.mkdir(parents=True)
    write_setup(worktree, "slot")
    return worktree


def lease(bin_dir, primary, slot, *args, **extra):
    env = dict(
        os.environ,
        PATH=f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
        TREEHOUSE_LOG=str(bin_dir.parent / "treehouse.log"),
        SETUP_LOG=str(bin_dir.parent / "setup.log"),
        SLOT=str(slot),
    )
    env.pop("TREEHOUSE_LEASE_HOLDER", None)
    env.update(extra)
    return subprocess.run(
        [str(primary / "scripts" / "th-lease.sh"), *args], env=env, cwd=bin_dir.parent, capture_output=True, text=True
    )


def setups(bin_dir):
    log = bin_dir.parent / "setup.log"
    return log.read_text().splitlines() if log.exists() else []


def test_the_slot_is_warmed_by_its_own_pre_warm_not_the_primarys(bin_dir, primary, slot):
    result = lease(bin_dir, primary, slot, "builder")

    assert result.returncode == 0, result.stderr
    assert setups(bin_dir) == [f"slot | {slot}"]
    assert "WARNING" not in result.stderr


def test_a_slot_with_no_pre_warm_of_its_own_is_warmed_by_the_primarys_and_says_so(bin_dir, primary, slot):
    (slot / "scripts" / "treehouse-setup.sh").unlink()

    result = lease(bin_dir, primary, slot)

    assert result.returncode == 0, result.stderr
    assert setups(bin_dir) == [f"primary | {slot}"]
    assert (
        f"[treehouse] WARNING: {slot} has no scripts/treehouse-setup.sh of its own;"
        f" pre-warming it with {primary}/scripts/treehouse-setup.sh"
    ) in result.stderr


def test_only_the_slots_path_is_on_stdout(bin_dir, primary, slot):
    result = lease(bin_dir, primary, slot)

    assert result.stdout == f"{slot}\n"
    assert f"[treehouse] ready: {slot}" in result.stderr


def test_a_failed_pre_warm_still_hands_out_the_slot(bin_dir, primary, slot):
    result = lease(bin_dir, primary, slot, SETUP_STATUS="1")

    assert result.returncode == 0
    assert result.stdout == f"{slot}\n"
    assert f"[treehouse] WARNING: pre-warm reported an error; worktree is leased at {slot}" in result.stderr


def test_the_lease_is_taken_from_the_primary_for_the_holder(bin_dir, primary, slot):
    lease(bin_dir, primary, slot, "builder")

    calls = (bin_dir.parent / "treehouse.log").read_text().splitlines()
    assert calls == [f"get --lease --lease-holder builder | cwd={primary}"]
