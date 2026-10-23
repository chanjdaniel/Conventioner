"""th-compose.sh run for real, with a stub `docker` first on PATH that records what it was asked to do."""

import os
import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
WRAPPER = REPO / "scripts" / "th-compose.sh"


@pytest.fixture
def docker_calls(tmp_path):
    """A stub docker that logs its arguments; returns the log's path."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log = tmp_path / "docker.log"
    stub = bin_dir / "docker"
    stub.write_text(f'#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "{log}"\n')
    stub.chmod(0o755)
    return bin_dir, log


@pytest.fixture
def slot(tmp_path):
    worktree = tmp_path / ".treehouse" / "Conventioner-abc123" / "3" / "Conventioner"
    worktree.mkdir(parents=True)
    shutil.copy(REPO / "docker-compose.yml", worktree)
    return worktree


def run_wrapper(worktree, bin_dir, *args, **extra):
    env = {k: v for k, v in os.environ.items() if not k.startswith(("COMPOSE_", "TH_", "TEAM_"))}
    env.update(TH_DIR=str(worktree), PATH=f"{bin_dir}{os.pathsep}{env['PATH']}", **extra)
    return subprocess.run([str(WRAPPER), *args], env=env, capture_output=True, text=True)


def test_the_volumes_nested_in_a_bind_mount_get_their_mountpoints_from_the_user(slot, docker_calls):
    # Docker creates a missing mountpoint as root, inside the worktree.
    bin_dir, log = docker_calls
    (slot / "back-end").mkdir()
    (slot / "front-end").mkdir()

    result = run_wrapper(slot, bin_dir, "up", "-d")

    assert result.returncode == 0, result.stderr
    for mountpoint in (slot / "back-end" / "flask_session", slot / "front-end" / "node_modules"):
        assert mountpoint.is_dir()
        assert mountpoint.stat().st_uid == os.getuid()
    assert log.read_text().startswith("compose -f ")


def test_a_missing_bind_source_is_never_created(slot, docker_calls):
    # A worktree whose sources are gone must fail to start, not start on empty directories.
    bin_dir, _ = docker_calls

    result = run_wrapper(slot, bin_dir, "up", "-d")

    assert result.returncode == 0, result.stderr
    assert not (slot / "back-end").exists()
    assert not (slot / "front-end").exists()


def test_an_explicit_identity_needs_no_mongo_express_port(tmp_path, docker_calls):
    # mongo-express is a tool, in its own profile; without a port Docker picks one.
    bin_dir, log = docker_calls
    worktree = tmp_path / "gate" / "Conventioner"
    worktree.mkdir(parents=True)
    shutil.copy(REPO / "docker-compose.yml", worktree)

    result = run_wrapper(
        worktree,
        bin_dir,
        "--profile",
        "tools",
        "up",
        "-d",
        "mongo-express",
        COMPOSE_PROJECT_NAME="nmtest-4242",
        TH_MONGO_PORT="41001",
        TH_BACKEND_PORT="41002",
        TH_FRONTEND_PORT="41003",
    )

    assert result.returncode == 0, result.stderr
    assert log.read_text().rstrip("\n").endswith(" --profile tools up -d mongo-express")
