"""The worktree overlay as Compose renders it through th-compose.sh: what every agent and nm-test.sh stack gets."""

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest
from build_inputs import copy_build_inputs

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


def render(worktree, *args, **env):
    result = subprocess.run(
        [str(WRAPPER), *args, "config", "--format", "json"],
        env=clean_env(TH_DIR=str(worktree), **env),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def slot_worktree(root, number):
    """A treehouse slot's worktree, as the wrapper reads it from the path: the base file and the images' build inputs."""
    worktree = root / ".treehouse" / "Conventioner-abc123" / str(number) / "Conventioner"
    worktree.mkdir(parents=True)
    shutil.copy(REPO / "docker-compose.yml", worktree)
    return copy_build_inputs(worktree)


@pytest.fixture
def slot(tmp_path):
    return slot_worktree(tmp_path, 3)


# No TH_MONGO_EXPRESS_PORT: the explicit mode does not need one, since mongo-express is a tool.
EXPLICIT = {
    "COMPOSE_PROJECT_NAME": "nmtest-4242",
    "TH_MONGO_PORT": "41001",
    "TH_BACKEND_PORT": "41002",
    "TH_FRONTEND_PORT": "41003",
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
    if any("create_host_path" in mount.get("bind", {}) for mount in binds.values()):
        assert {where: mount["bind"].get("create_host_path") for where, mount in binds.items()} == {
            where: False for where in binds
        }
    else:
        # Compose <= 2.38 (CI's) drops a false bool, its zero value, from `config`'s JSON:
        # read the overlay's own keys instead, never a comment that quotes them.
        keys = [
            line.strip()
            for line in (REPO / "docker-compose.worktree.yml").read_text().splitlines()
            if line.strip().startswith("create_host_path:")
        ]
        assert keys == ["create_host_path: false"] * len(binds)
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


def published(config):
    return {
        name: [(port["host_ip"], port.get("published", ""), port["target"]) for port in spec.get("ports", [])]
        for name, spec in config["services"].items()
    }


def test_every_port_is_published_on_loopback_with_the_ports_host_port(worktree_and_env):
    worktree, env = worktree_and_env
    config = render(worktree, "--profile", "tools", **env)

    if env:
        expected = {
            "mongodb": [("127.0.0.1", "41001", 27017)],
            "backend": [("127.0.0.1", "41002", 5000)],
            "frontend": [("127.0.0.1", "41003", 5173)],
            # Docker picks a free host port when none is named.
            "mongo-express": [("127.0.0.1", "", 8081)],
        }
    else:  # slot 3: offset 30
        expected = {
            "mongodb": [("127.0.0.1", "27047", 27017)],
            "backend": [("127.0.0.1", "5030", 5000)],
            "frontend": [("127.0.0.1", "5203", 5173)],
            "mongo-express": [("127.0.0.1", "8111", 8081)],
        }
    assert published(config) == expected


def test_auto_mode_leaves_every_host_port_empty_for_docker_to_pick():
    # The caller's own ports are ignored: Docker assigns each one as the container starts.
    result = subprocess.run(
        [str(WRAPPER), "--profile", "tools", "config", "--format", "json"],
        env=clean_env(TH_DIR=str(REPO), COMPOSE_PROJECT_NAME="nmtest-4242", TH_PORTS="auto", TH_BACKEND_PORT="41002"),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr

    assert published(json.loads(result.stdout)) == {
        "mongodb": [("127.0.0.1", "", 27017)],
        "backend": [("127.0.0.1", "", 5000)],
        "frontend": [("127.0.0.1", "", 5173)],
        "mongo-express": [("127.0.0.1", "", 8081)],
    }
    assert "not set" not in result.stderr


def test_mongo_express_starts_only_with_the_tools_profile(worktree_and_env):
    worktree, env = worktree_and_env

    assert set(render(worktree, **env)["services"]) == {"mongodb", "backend", "frontend"}
    assert "mongo-express" in render(worktree, "--profile", "tools", **env)["services"]


def test_every_service_runs_within_its_limits(worktree_and_env):
    worktree, env = worktree_and_env
    config = render(worktree, "--profile", "tools", **env)

    limits = {
        name: (int(spec["mem_limit"]), float(spec["cpus"]), spec["pids_limit"])
        for name, spec in config["services"].items()
    }
    mib = 1024 * 1024
    assert limits == {
        "mongodb": (1024 * mib, 2.0, 512),
        "backend": (768 * mib, 1.0, 256),
        "frontend": (1024 * mib, 2.0, 256),
        "mongo-express": (256 * mib, 0.5, 64),
    }


def test_mongodb_keeps_its_flags_and_sizes_its_cache_for_its_limit(worktree_and_env):
    worktree, env = worktree_and_env
    config = render(worktree, **env)

    assert config["services"]["mongodb"]["command"] == [
        "mongod",
        "--quiet",
        "--logpath",
        "/var/log/mongodb/mongod.log",
        "--wiredTigerCacheSizeGB",
        "0.25",
    ]


def test_email_is_off_unless_the_caller_turns_it_on(worktree_and_env):
    worktree, env = worktree_and_env

    assert render(worktree, **env)["services"]["backend"]["environment"]["DISABLE_EMAIL"] == "true"
    on = render(worktree, **env, DISABLE_EMAIL="false")
    assert on["services"]["backend"]["environment"]["DISABLE_EMAIL"] == "false"


def test_the_primary_stack_publishes_its_fixed_ports_on_loopback():
    # The base file alone is Daniel's primary stack and CI's stack.
    result = subprocess.run(
        ["docker", "compose", "-f", str(REPO / "docker-compose.yml"), "config", "--format", "json"],
        env=clean_env(),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr

    assert published(json.loads(result.stdout)) == {
        "mongodb": [("127.0.0.1", "27017", 27017)],
        "backend": [("127.0.0.1", "5000", 5000)],
        "frontend": [("127.0.0.1", "5173", 5173)],
        "mongo-express": [("127.0.0.1", "8081", 8081)],
    }


def image_tags(worktree):
    result = subprocess.run([str(REPO / "scripts" / "image-tags.sh"), str(worktree)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    return dict(line.split("=", 1) for line in result.stdout.splitlines())


def test_the_back_end_and_front_end_run_the_shared_images_of_their_build_inputs(worktree_and_env):
    worktree, env = worktree_and_env
    tags = image_tags(worktree)

    services = render(worktree, **env)["services"]

    assert services["backend"]["image"] == f"conventioner/backend:{tags['TH_BACKEND_TAG']}"
    assert services["frontend"]["image"] == f"conventioner/frontend:{tags['TH_FRONTEND_TAG']}"


def test_a_shared_image_is_built_when_missing_and_never_pulled(worktree_and_env):
    # Docker Hub's conventioner/* is not ours: a missing image is built from the worktree.
    worktree, env = worktree_and_env
    services = render(worktree, **env)["services"]

    for name in ("backend", "frontend"):
        assert services[name]["pull_policy"] == "never", name
        assert "build" in services[name], name


def test_two_slots_with_the_same_dependencies_run_the_same_images(tmp_path):
    images = [
        {name: spec.get("image") for name, spec in render(slot_worktree(tmp_path, number))["services"].items()}
        for number in (2, 3)
    ]

    assert images[0] == images[1]
    assert images[0]["backend"].startswith("conventioner/backend:")


def test_the_primary_stack_names_its_own_images():
    # The base file alone, Daniel's primary stack and CI's, builds images named after its project.
    result = subprocess.run(
        ["docker", "compose", "-f", str(REPO / "docker-compose.yml"), "-p", "conventioner", "config", "--images"],
        env=clean_env(),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr

    assert set(result.stdout.split()) == {
        "mongo:7",
        "conventioner-backend",
        "conventioner-frontend",
        "mongo-express:latest",
    }
