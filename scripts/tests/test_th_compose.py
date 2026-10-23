"""th-compose.sh run for real, with a stub `docker` first on PATH that records what it was asked to do."""

import os
import shutil
import subprocess
from pathlib import Path

import pytest
from build_inputs import copy_build_inputs

REPO = Path(__file__).resolve().parents[2]
WRAPPER = REPO / "scripts" / "th-compose.sh"


# The host ports the stub reports, as Docker would after an `up` with empty host ports.
ASSIGNED = {"mongodb": "49153", "backend": "49154", "frontend": "49155", "mongo-express": "49156"}

# A stub docker that logs its arguments with the stack's port variables and image tags as compose
# sees them, answers `image inspect <image>` like Docker, with no such image for each repository
# named in $MISSING, and answers `compose ... port <service> <port>` like Docker for each service
# named in $RUNNING.
STUB = """#!/usr/bin/env bash
printf '%s | mongo=%s backend=%s frontend=%s express=%s | tags=%s %s\\n' "$*" \\
  "${TH_MONGO_PORT-unset}" "${TH_BACKEND_PORT-unset}" "${TH_FRONTEND_PORT-unset}" \\
  "${TH_MONGO_EXPRESS_PORT-unset}" "${TH_BACKEND_TAG-unset}" "${TH_FRONTEND_TAG-unset}" >> "$DOCKER_LOG"
if [ "$1 $2" = "image inspect" ]; then
  image="${!#}"
  case " $MISSING " in
    *" ${image%%:*} "*) echo "Error: No such image: $image" >&2; exit 1 ;;
  esac
  exit 0
fi
while [ $# -gt 0 ] && [ "$1" != port ]; do shift; done
[ $# -eq 0 ] && exit 0
case " $RUNNING " in
  *" $2 "*) ;;
  *) echo "service \\"$2\\" is not running" >&2; exit 1 ;;
esac
case "$2" in
""" + "".join(f"  {service}) echo 127.0.0.1:{port} ;;\n" for service, port in ASSIGNED.items()) + """esac
"""

ALL_RUNNING = " ".join(ASSIGNED)


@pytest.fixture
def docker_calls(tmp_path):
    """A stub docker that logs its arguments; returns its directory and the log's path."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    stub = bin_dir / "docker"
    stub.write_text(STUB)
    stub.chmod(0o755)
    return bin_dir, tmp_path / "docker.log"


@pytest.fixture
def slot(tmp_path):
    worktree = tmp_path / ".treehouse" / "Conventioner-abc123" / "3" / "Conventioner"
    worktree.mkdir(parents=True)
    shutil.copy(REPO / "docker-compose.yml", worktree)
    return copy_build_inputs(worktree)


def run_wrapper(worktree, bin_dir, *args, **extra):
    env = {k: v for k, v in os.environ.items() if not k.startswith(("COMPOSE_", "TH_", "TEAM_"))}
    env.update(
        TH_DIR=str(worktree),
        PATH=f"{bin_dir}{os.pathsep}{env['PATH']}",
        DOCKER_LOG=str(bin_dir.parent / "docker.log"),
        RUNNING=ALL_RUNNING,
        MISSING="",
    )
    env.update(extra)
    return subprocess.run([str(WRAPPER), *args], env=env, capture_output=True, text=True)


def calls(log):
    return log.read_text().splitlines()


def compose_calls(log):
    """What compose was asked to do, without the arguments' variables."""
    return [call.split(" | ")[0] for call in calls(log) if call.startswith("compose ")]


def compose_args(log):
    """Each compose call's arguments past the two compose files."""
    return [call.split(".yml ", 2)[-1] for call in compose_calls(log)]


def test_the_volumes_nested_in_a_bind_mount_get_their_mountpoints_from_the_user(slot, docker_calls):
    # Docker creates a missing mountpoint as root, inside the worktree.
    bin_dir, log = docker_calls

    result = run_wrapper(slot, bin_dir, "up", "-d")

    assert result.returncode == 0, result.stderr
    for mountpoint in (slot / "back-end" / "flask_session", slot / "front-end" / "node_modules"):
        assert mountpoint.is_dir()
        assert mountpoint.stat().st_uid == os.getuid()
    assert compose_args(log) == ["up -d"]


def test_a_missing_bind_source_is_never_created(tmp_path, docker_calls):
    # A worktree whose sources are gone must fail to start, not start on empty directories.
    bin_dir, log = docker_calls
    worktree = tmp_path / ".treehouse" / "Conventioner-abc123" / "3" / "Conventioner"
    worktree.mkdir(parents=True)
    shutil.copy(REPO / "docker-compose.yml", worktree)

    result = run_wrapper(worktree, bin_dir, "up", "-d")

    assert result.returncode == 1
    assert "back-end/Dockerfile is missing" in result.stderr
    assert not (worktree / "back-end").exists()
    assert not (worktree / "front-end").exists()
    assert not log.exists()


def test_an_explicit_identity_needs_no_mongo_express_port(tmp_path, docker_calls):
    # mongo-express is a tool, in its own profile; without a port Docker picks one.
    bin_dir, log = docker_calls
    worktree = copy_build_inputs(tmp_path / "gate" / "Conventioner")
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
    assert compose_args(log) == ["--profile tools up -d mongo-express"]


@pytest.fixture
def gate(tmp_path):
    """A worktree outside the treehouse, as the gate's is."""
    worktree = tmp_path / "gate" / "Conventioner"
    worktree.mkdir(parents=True)
    shutil.copy(REPO / "docker-compose.yml", worktree)
    return copy_build_inputs(worktree)


AUTO = {"COMPOSE_PROJECT_NAME": "nmtest-4242", "TH_PORTS": "auto"}


def assigned_lines(stderr):
    return [line for line in stderr.splitlines() if line.startswith("TH_")]


def test_auto_mode_leaves_every_host_port_to_docker(gate, docker_calls):
    # Even ports the caller set: a stack started in auto mode keeps its config however it is called.
    bin_dir, log = docker_calls

    result = run_wrapper(gate, bin_dir, "build", **AUTO, TH_BACKEND_PORT="41002", TH_MONGO_EXPRESS_PORT="41004")

    assert result.returncode == 0, result.stderr
    assert [call.split(" | ")[:2] for call in calls(log)] == [
        [f"compose -f {gate}/docker-compose.yml -f {REPO}/docker-compose.worktree.yml build", "mongo= backend= frontend= express="]
    ]


def test_after_an_up_in_auto_mode_the_assigned_ports_are_printed(gate, docker_calls):
    bin_dir, log = docker_calls

    result = run_wrapper(gate, bin_dir, "up", "-d", **AUTO, RUNNING="mongodb backend frontend")

    assert result.returncode == 0, result.stderr
    assert assigned_lines(result.stderr) == [
        "TH_MONGO_PORT=49153",
        "TH_BACKEND_PORT=49154",
        "TH_FRONTEND_PORT=49155",
    ]
    assert result.stdout == ""
    assert compose_args(log)[0] == "up -d"


def test_the_printed_ports_are_those_of_the_services_that_run(gate, docker_calls):
    # Global options come before the subcommand; mongo-express gets a line when it runs.
    bin_dir, _ = docker_calls

    result = run_wrapper(
        gate, bin_dir, "--profile", "tools", "up", "-d", "mongo-express", **AUTO, RUNNING="mongo-express"
    )

    assert result.returncode == 0, result.stderr
    assert assigned_lines(result.stderr) == ["TH_MONGO_EXPRESS_PORT=49156"]


def test_a_failed_up_prints_no_ports_and_keeps_its_status(gate, docker_calls):
    bin_dir, _ = docker_calls
    failing = bin_dir / "docker"
    failing.write_text(STUB.replace("#!/usr/bin/env bash\n", '#!/usr/bin/env bash\ncase "$*" in *" up -d") exit 3 ;; esac\n', 1))

    result = run_wrapper(gate, bin_dir, "up", "-d", **AUTO)

    assert result.returncode == 3
    assert assigned_lines(result.stderr) == []


def test_other_modes_print_no_ports_after_an_up(slot, gate, docker_calls):
    bin_dir, _ = docker_calls

    for result in (
        run_wrapper(slot, bin_dir, "up", "-d"),
        run_wrapper(
            gate,
            bin_dir,
            "up",
            "-d",
            COMPOSE_PROJECT_NAME="nmtest-4242",
            TH_MONGO_PORT="41001",
            TH_BACKEND_PORT="41002",
            TH_FRONTEND_PORT="41003",
        ),
    ):
        assert result.returncode == 0, result.stderr
        assert assigned_lines(result.stderr) == []


def test_ports_prints_the_running_stacks_ports_as_exports(slot, gate, docker_calls):
    # Read from Docker in every mode, so a slot's stack answers with what it was started with.
    bin_dir, log = docker_calls

    for worktree, env, project in ((gate, AUTO, "nmtest-4242"), (slot, {}, "conventioner-3")):
        result = run_wrapper(worktree, bin_dir, "ports", **env, RUNNING="mongodb backend frontend")

        assert result.returncode == 0, result.stderr
        assert result.stdout.splitlines() == [
            f"export COMPOSE_PROJECT_NAME={project}",
            "export TH_MONGO_PORT=49153",
            "export TH_BACKEND_PORT=49154",
            "export TH_FRONTEND_PORT=49155",
        ]
    assert all(" port " in call for call in calls(log))


def test_ports_includes_mongo_express_when_it_runs(gate, docker_calls):
    bin_dir, _ = docker_calls

    result = run_wrapper(gate, bin_dir, "ports", **AUTO)

    assert result.returncode == 0, result.stderr
    assert result.stdout.splitlines()[-1] == "export TH_MONGO_EXPRESS_PORT=49156"


def test_ports_fails_when_the_stack_is_not_running(gate, docker_calls):
    bin_dir, _ = docker_calls

    result = run_wrapper(gate, bin_dir, "ports", **AUTO, RUNNING="mongodb frontend")

    assert result.returncode == 1
    assert result.stdout == ""
    assert "backend" in result.stderr


def test_auto_mode_needs_a_project_name(slot, docker_calls):
    # Even in a slot: two auto-mode stacks of one worktree must not share the slot's project.
    bin_dir, log = docker_calls

    result = run_wrapper(slot, bin_dir, "up", "-d", TH_PORTS="auto")

    assert result.returncode == 1
    assert "COMPOSE_PROJECT_NAME" in result.stderr
    assert not log.exists()


def test_an_unknown_ports_mode_is_refused(gate, docker_calls):
    bin_dir, log = docker_calls

    result = run_wrapper(gate, bin_dir, "up", "-d", COMPOSE_PROJECT_NAME="nmtest-4242", TH_PORTS="random")

    assert result.returncode == 1
    assert "TH_PORTS" in result.stderr
    assert not log.exists()


def image_tags(worktree):
    result = subprocess.run([str(REPO / "scripts" / "image-tags.sh"), str(worktree)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    return dict(line.split("=", 1) for line in result.stdout.splitlines())


def test_compose_gets_the_tags_of_the_worktrees_build_inputs(slot, docker_calls):
    # Whatever the caller set: the tag says what the image was built from.
    bin_dir, log = docker_calls
    tags = image_tags(slot)

    result = run_wrapper(slot, bin_dir, "up", "-d", TH_BACKEND_TAG="stale")

    assert result.returncode == 0, result.stderr
    expected = f"tags={tags['TH_BACKEND_TAG']} {tags['TH_FRONTEND_TAG']}"
    assert {call.split(" | ")[2] for call in calls(log)} == {expected}


def test_an_up_builds_nothing_when_both_images_exist(slot, docker_calls):
    bin_dir, log = docker_calls
    tags = image_tags(slot)

    result = run_wrapper(slot, bin_dir, "up", "-d")

    assert result.returncode == 0, result.stderr
    assert [call.split(" | ")[0] for call in calls(log) if call.startswith("image ")] == [
        f"image inspect conventioner/backend:{tags['TH_BACKEND_TAG']}",
        f"image inspect conventioner/frontend:{tags['TH_FRONTEND_TAG']}",
    ]
    assert compose_args(log) == ["up -d"]


def test_an_up_builds_only_the_image_that_is_missing(slot, docker_calls):
    bin_dir, log = docker_calls

    result = run_wrapper(slot, bin_dir, "up", "-d", MISSING="conventioner/frontend")

    assert result.returncode == 0, result.stderr
    assert compose_args(log) == ["build frontend", "up -d"]
    assert "building conventioner/frontend:" in result.stderr


def test_a_failed_build_starts_nothing(slot, docker_calls):
    bin_dir, log = docker_calls
    failing = bin_dir / "docker"
    failing.write_text(STUB.replace("#!/usr/bin/env bash\n", '#!/usr/bin/env bash\ncase "$*" in *" build backend") exit 4 ;; esac\n', 1))

    result = run_wrapper(slot, bin_dir, "up", "-d", MISSING="conventioner/backend")

    assert result.returncode == 4
    assert compose_args(log) == []


def test_ensure_images_builds_what_is_missing_and_starts_nothing(gate, docker_calls):
    bin_dir, log = docker_calls

    result = run_wrapper(gate, bin_dir, "ensure-images", **AUTO, MISSING="conventioner/backend conventioner/frontend")

    assert result.returncode == 0, result.stderr
    assert compose_args(log) == ["build backend", "build frontend"]
    assert assigned_lines(result.stderr) == []


def test_ensure_images_with_both_images_there_does_nothing(gate, docker_calls):
    bin_dir, log = docker_calls

    result = run_wrapper(gate, bin_dir, "ensure-images", **AUTO)

    assert result.returncode == 0, result.stderr
    assert compose_calls(log) == []


def test_build_always_builds(slot, docker_calls):
    # `build` is the way to rebuild an image whose inputs did not change, say for a newer base image.
    bin_dir, log = docker_calls

    result = run_wrapper(slot, bin_dir, "build")

    assert result.returncode == 0, result.stderr
    assert [call.split(" | ")[0] for call in calls(log) if call.startswith("image ")] == []
    assert compose_args(log) == ["build"]
