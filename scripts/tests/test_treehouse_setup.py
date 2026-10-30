"""treehouse-setup.sh run for real on a cold slot, with a stub `npm` first on PATH that acts as an npm whose
`install` rewrites the lockfile (as one older than the lockfile's writer does)."""

import os
import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
SETUP = REPO / "scripts" / "treehouse-setup.sh"
PIN = (REPO / ".nvmrc").read_text().strip()

# A stub node that reports $NODE_VERSION, the pinned one unless a test says otherwise.
NODE_STUB = """#!/usr/bin/env bash
echo "${NODE_VERSION}"
"""

# A stub npm that logs its arguments, rewrites the lockfile on `install`, fills node_modules on `ci`,
# and, when $CI_FAILS is set, fails part-way through `npm ci` as it does on a lockfile out of step with
# package.json, printing its error unless its loglevel is silent.
NPM_STUB = """#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$NPM_LOG"
prefix=. command= loglevel=notice
while [ $# -gt 0 ]; do
  case "$1" in
    --prefix) prefix="$2"; shift 2 ;;
    --silent) loglevel=silent; shift ;;
    --loglevel=*) loglevel="${1#--loglevel=}"; shift ;;
    install | ci) command="$1"; shift ;;
    *) shift ;;
  esac
done
if [ "$command" = install ]; then
  echo '{"rewritten": true}' > "$prefix/package-lock.json"
fi
mkdir -p "$prefix/node_modules"
if [ "$command" = ci ] && [ -n "${CI_FAILS:-}" ]; then
  if [ "$loglevel" != silent ]; then
    echo "npm error \\`npm ci\\` can only install packages when your package.json and package-lock.json are in sync." >&2
  fi
  exit 1
fi
"""


@pytest.fixture
def bin_dir(tmp_path):
    stubs = tmp_path / "bin"
    stubs.mkdir()
    for name, body in (("npm", NPM_STUB), ("node", NODE_STUB)):
        (stubs / name).write_text(body)
        (stubs / name).chmod(0o755)
    return stubs


@pytest.fixture
def slot(tmp_path):
    """A cold slot: a fresh checkout of the front end's package files, with nothing ignored in it yet."""
    worktree = tmp_path / "Conventioner"
    (worktree / "front-end").mkdir(parents=True)
    for name in ("package.json", "package-lock.json"):
        shutil.copy(REPO / "front-end" / name, worktree / "front-end" / name)
    shutil.copy(REPO / ".nvmrc", worktree / ".nvmrc")
    (worktree / "scripts").mkdir()
    shutil.copy(REPO / "scripts" / "merge_node.py", worktree / "scripts" / "merge_node.py")
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
    env = dict(
        os.environ,
        PATH=f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
        NPM_LOG=str(bin_dir.parent / "npm.log"),
        NODE_VERSION=f"v{PIN}",
    )
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
    assert "npm error `npm ci` can only install packages" in result.stderr
    assert not (slot / "front-end" / "node_modules").exists()


def test_a_failed_install_still_leaves_the_real_data_hooks_on(bin_dir, slot):
    # th-lease.sh hands out the slot even when the pre-warm fails, so the hooks come first.
    result = warm(bin_dir, slot, CI_FAILS="1")

    assert result.returncode != 0
    hooks = subprocess.run(
        ["git", "-C", str(slot), "config", "--get", "core.hooksPath"], capture_output=True, text=True
    )
    assert hooks.stdout.strip() == ".githooks"


def test_a_failed_install_still_leaves_the_node_merge_driver_registered(bin_dir, slot):
    result = warm(bin_dir, slot, CI_FAILS="1")

    assert result.returncode != 0
    driver = subprocess.run(
        ["git", "-C", str(slot), "config", "--get", "merge.kg-node.driver"], capture_output=True, text=True
    )
    assert driver.stdout.strip() == "python3 scripts/merge_node.py %O %A %B %L %P %S %X %Y"


def test_a_warm_slot_is_left_alone(bin_dir, slot):
    (slot / "front-end" / "node_modules").mkdir()

    result = warm(bin_dir, slot)

    assert result.returncode == 0, result.stderr
    assert not (bin_dir.parent / "npm.log").exists()


def test_a_machine_off_the_pinned_node_is_warned(bin_dir, slot):
    result = warm(bin_dir, slot, NODE_VERSION="v22.19.0")

    assert result.returncode == 0, result.stderr
    assert f"[treehouse]   WARNING: node is v22.19.0, the repository pins {PIN} (.nvmrc)" in result.stderr


def test_the_pinned_node_warns_of_nothing(bin_dir, slot):
    result = warm(bin_dir, slot)

    assert result.returncode == 0, result.stderr
    assert "WARNING" not in result.stderr


def test_a_slot_without_a_pinned_node_still_warms(bin_dir, slot):
    (slot / ".nvmrc").unlink()

    result = warm(bin_dir, slot, NODE_VERSION="v22.19.0")

    assert result.returncode == 0, result.stderr
    assert (slot / "front-end" / "node_modules").is_dir()
    assert "WARNING" not in result.stderr


@pytest.mark.skipif(shutil.which("npm") is None, reason="npm is not installed")
def test_the_machine_s_own_npm_warms_a_cold_slot(tmp_path):
    # The real npm, on a front end whose one dependency is a local folder so it installs offline, in
    # a slot reached through a symlink (macOS's /tmp is one): there npm 11's `ci --prefix` names the
    # root package after its folder and refuses a lockfile that names it after package.json.
    worktree = tmp_path / "Conventioner"
    front_end = worktree / "front-end"
    (front_end / "local").mkdir(parents=True)
    (front_end / "local" / "package.json").write_text('{"name": "local", "version": "1.0.0"}\n')
    (front_end / "package.json").write_text(
        '{"name": "conventioner-frontend", "version": "0.0.0", "private": true,'
        ' "dependencies": {"local": "file:./local"}}\n'
    )
    subprocess.run(
        ["npm", "install", "--package-lock-only", "--no-audit", "--no-fund"],
        cwd=front_end,
        check=True,
        capture_output=True,
    )
    (worktree / ".gitignore").write_text("node_modules/\n")
    git = ["git", "-C", str(worktree)]
    subprocess.run([*git, "init", "-q"], check=True)
    subprocess.run([*git, "add", "."], check=True)
    subprocess.run(
        [*git, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--no-verify", "-m", "cold"],
        check=True,
    )

    linked = tmp_path / "linked"
    linked.symlink_to(worktree)

    result = subprocess.run(
        [str(SETUP)], env=dict(os.environ, TREEHOUSE_DIR=str(linked)), capture_output=True, text=True
    )

    assert result.returncode == 0, result.stderr
    assert (front_end / "node_modules").is_dir()
    status = subprocess.run([*git, "status", "--porcelain"], capture_output=True, text=True)
    assert status.stdout == ""
