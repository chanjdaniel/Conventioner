"""The worktree overlay as Compose renders it through th-compose.sh: what every agent and gate stack gets."""

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
WRAPPER = REPO / "scripts" / "th-compose.sh"
PREFIX = "io.github.chanjdaniel.team."
LABELS = ("owner", "task", "kind", "worktree", "expires")


def compose_available():
    if shutil.which("docker") is None:
        return False
    return subprocess.run(["docker", "compose", "version"], capture_output=True).returncode == 0


pytestmark = pytest.mark.skipif(not compose_available(), reason="docker compose is not installed")


def clean_env(**extra):
    """The caller's environment without any stack identity or team label: the gate exports both."""
    env = {
        k: v
        for k, v in os.environ.items()
        if not k.startswith(("COMPOSE_", "TH_", "TEAM_")) and k not in {"DISABLE_EMAIL", "DISABLE_CAPTCHA"}
    }
    env.update(extra)
    return env


def render(worktree, **env):
    result = subprocess.run(
        [str(WRAPPER), "config", "--format", "json"],
        env=clean_env(TH_DIR=str(worktree), **env),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


@pytest.fixture
def slot(tmp_path):
    """A treehouse slot's worktree, as the wrapper reads it from the path; only the base file is needed."""
    worktree = tmp_path / ".treehouse" / "Conventioner-abc123" / "3" / "Conventioner"
    worktree.mkdir(parents=True)
    shutil.copy(REPO / "docker-compose.yml", worktree)
    return worktree


EXPLICIT = {
    "COMPOSE_PROJECT_NAME": "nmtest-4242",
    "TH_MONGO_PORT": "41001",
    "TH_BACKEND_PORT": "41002",
    "TH_FRONTEND_PORT": "41003",
    "TH_MONGO_EXPRESS_PORT": "41004",
}

TEAM = {
    "TEAM_OWNER": "agent-team",
    "TEAM_TASK": "T22",
    "TEAM_KIND": "gate",
    "TEAM_WORKTREE": "/somewhere/Conventioner",
    "TEAM_EXPIRES": "2026-10-23T16:00:00Z",
}


def labelled(config):
    """Every object Compose creates for the stack that can carry a label."""
    for kind in ("services", "volumes", "networks"):
        for name, spec in config[kind].items():
            yield f"{kind}.{name}", spec.get("labels", {})


def team_labels(labels):
    return {k[len(PREFIX) :]: v for k, v in labels.items() if k.startswith(PREFIX)}


@pytest.fixture(params=["slot", "explicit"])
def worktree_and_env(request, slot):
    if request.param == "slot":
        return slot, {}
    return REPO, EXPLICIT


def test_every_object_carries_the_team_labels_from_the_environment(worktree_and_env):
    worktree, env = worktree_and_env
    config = render(worktree, **env, **TEAM)

    for where, labels in labelled(config):
        assert team_labels(labels) == {key: TEAM[f"TEAM_{key.upper()}"] for key in LABELS}, where


def test_each_label_is_empty_when_its_variable_is_unset(worktree_and_env):
    worktree, env = worktree_and_env
    config = render(worktree, **env)

    for where, labels in labelled(config):
        assert team_labels(labels) == {key: "" for key in LABELS}, where


def test_no_service_restarts_by_itself(worktree_and_env):
    worktree, env = worktree_and_env
    config = render(worktree, **env)

    assert {name: spec.get("restart") for name, spec in config["services"].items()} == {
        name: "no" for name in config["services"]
    }


def test_no_bind_mount_creates_its_missing_source(worktree_and_env):
    worktree, env = worktree_and_env
    config = render(worktree, **env)

    binds = {
        (name, mount["target"]): mount
        for name, spec in config["services"].items()
        for mount in spec.get("volumes", [])
        if mount["type"] == "bind"
    }
    assert set(binds) == {
        ("mongodb", "/docker-entrypoint-initdb.d/mongo-init.js"),
        ("backend", "/app"),
        ("frontend", "/app"),
    }
    for where, mount in binds.items():
        assert mount["bind"]["create_host_path"] is False, where
    # Relative sources stay relative to the worktree, not to the wrapper's own checkout.
    assert binds[("backend", "/app")]["source"] == str(worktree / "back-end")
    assert binds[("mongodb", "/docker-entrypoint-initdb.d/mongo-init.js")]["read_only"] is True


def test_restating_the_mounts_keeps_the_volumes(worktree_and_env):
    worktree, env = worktree_and_env
    config = render(worktree, **env)

    volumes = {
        (name, mount["target"]): mount.get("source")
        for name, spec in config["services"].items()
        for mount in spec.get("volumes", [])
        if mount["type"] == "volume"
    }
    assert volumes == {
        ("mongodb", "/data/db"): "mongodb_data",
        ("backend", "/app/flask_session"): "backend_sessions",
        ("frontend", "/app/node_modules"): None,
    }
