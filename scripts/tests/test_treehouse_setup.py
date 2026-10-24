"""treehouse-setup.sh run for real on a cold slot, with a stub `npm` first on PATH that acts as an npm whose
`install` rewrites the lockfile (as one older than the lockfile's writer does)."""

import os
import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
SETUP = REPO / "scripts" / "treehouse-setup.sh"

# A stub npm that logs its arguments, rewrites the lockfile on `install`, fills node_modules on `ci`,
# and fails as `npm ci` does on a lockfile out of step with package.json when $CI_FAILS is set.
NPM_STUB = """#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$NPM_LOG"
prefix=. command=
while [ $# -gt 0 ]; do
  case "$1" in
    --prefix) prefix="$2"; shift 2 ;;
    install | ci) command="$1"; shift ;;
    *) shift ;;
  esac
done
if [ "$command" = install ]; then
  echo '{"rewritten": true}' > "$prefix/package-lock.json"
elif [ -n "${CI_FAILS:-}" ]; then
  echo "npm error \\`npm ci\\` can only install packages when your package.json and package-lock.json are in sync." >&2
  exit 1
fi
mkdir -p "$prefix/node_modules"
"""


@pytest.fixture
def bin_dir(tmp_path):
    stubs = tmp_path / "bin"
    stubs.mkdir()
    (stubs / "npm").write_text(NPM_STUB)
    (stubs / "npm").chmod(0o755)
    return stubs


@pytest.fixture
def slot(tmp_path):
    """A cold slot: a fresh checkout of the front end's package files, with nothing ignored in it yet."""
    worktree = tmp_path / "Conventioner"
    (worktree / "front-end").mkdir(parents=True)
    for name in ("package.json", "package-lock.json"):
        shutil.copy(REPO / "front-end" / name, worktree / "front-end" / name)
    (worktree / ".gitignore").write_text("node_modules/\n")
    git = ["git", "-C", str(worktree)]
    subprocess.run([*git, "init", "-q"], check=True)
    subprocess.run([*git, "add", "."], check=True)
    subprocess.run(
        [*git, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--no-verify", "-m", "cold"],
        check=True,
    )
    return worktree


def warm(bin_dir, slot, **extra):
    env = dict(os.environ, PATH=f"{bin_dir}{os.pathsep}{os.environ['PATH']}", NPM_LOG=str(bin_dir.parent / "npm.log"))
    env.update(extra)
    return subprocess.run([str(SETUP)], env=env | {"TREEHOUSE_DIR": str(slot)}, capture_output=True, text=True)


def test_warming_a_cold_slot_leaves_it_clean(bin_dir, slot):
    result = warm(bin_dir, slot)

    assert result.returncode == 0, result.stderr
    assert (slot / "front-end" / "node_modules").is_dir()
    status = subprocess.run(["git", "-C", str(slot), "status", "--porcelain"], capture_output=True, text=True)
    assert status.stdout == ""


def test_the_pre_warm_installs_with_npm_ci(bin_dir, slot):
    warm(bin_dir, slot)

    calls = (bin_dir.parent / "npm.log").read_text().splitlines()
    assert len(calls) == 1
    assert "ci" in calls[0].split()
    assert "install" not in calls[0].split()


def test_a_lockfile_out_of_step_fails_the_pre_warm_loudly(bin_dir, slot):
    result = warm(bin_dir, slot, CI_FAILS="1")

    assert result.returncode != 0
    assert "[treehouse]   ERROR: npm ci failed" in result.stderr
    assert not (slot / "front-end" / "node_modules").exists()


def test_a_warm_slot_is_left_alone(bin_dir, slot):
    (slot / "front-end" / "node_modules").mkdir()

    result = warm(bin_dir, slot)

    assert result.returncode == 0, result.stderr
    assert not (bin_dir.parent / "npm.log").exists()
