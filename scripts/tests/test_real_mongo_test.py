"""real-mongo-test.sh runs the real-MongoDB suite on a server of its own, and leaves nothing behind.

A MongoDB started by hand for the suite (`docker run ... mongo:7`, then `docker rm -f`) left the
image's two anonymous volumes, `/data/db` and `/data/configdb`, about 0.3 GB a run, with no label
saying whose they were. The script's server keeps both on tmpfs, is removed when it stops, and is
removed however the run ends.

The script is run for real, with a stub `docker` and a stub Python that log every call.
"""

import os
import signal
import subprocess
import time
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "scripts" / "real-mongo-test.sh"

# A stub docker: the compose file's mongodb image is $COMPOSE_MONGO_IMAGE, `run` prints an id,
# `port` answers the published port, and `exec ... mongosh` answers the ping unless $MONGO_SILENT.
DOCKER = """#!/usr/bin/env bash
printf 'docker %s\\n' "$*" >> "$CALL_LOG"
case "$*" in
  compose*"config --images mongodb") echo "$COMPOSE_MONGO_IMAGE" ;;
  "run "*) echo 0123456789ab ;;
  "port "*) echo 127.0.0.1:49200 ;;
  "exec "*) [ -z "${MONGO_SILENT:-}" ] ;;
esac
"""

# A stub Python: logs what the suite would have been given, and exits $PYTEST_STATUS; with
# $PYTEST_HANGS it writes its pid to $PYTEST_PID and waits, as a long suite does.
PYTHON = """#!/usr/bin/env bash
case "$*" in
  "-c "*) exec python3 "$@" ;;
esac
printf 'python %s | cwd=%s uri=%s required=%s\\n' "$*" "$PWD" "${REAL_MONGODB_URI-unset}" "${REAL_MONGODB_REQUIRED-unset}" >> "$CALL_LOG"
if [ -n "${PYTEST_HANGS:-}" ]; then
  echo $$ > "$PYTEST_PID"
  exec /bin/sleep 60
fi
exit "${PYTEST_STATUS:-0}"
"""

SLEEP = "#!/usr/bin/env bash\nexit 0\n"


def stub(directory, name, body):
    path = directory / name
    path.write_text(body)
    path.chmod(0o755)
    return path


def environment(tmp_path, **extra):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    stub(bin_dir, "docker", DOCKER)
    stub(bin_dir, "sleep", SLEEP)
    python = stub(bin_dir, "python-stub", PYTHON)
    env = {k: v for k, v in os.environ.items() if not k.startswith(("COMPOSE_", "TH_", "TEAM_", "REAL_MONGODB_"))}
    env.update(
        PATH=f"{bin_dir}{os.pathsep}{env['PATH']}",
        PYTHON_CMD=str(python),
        CALL_LOG=str(tmp_path / "calls.log"),
        COMPOSE_MONGO_IMAGE="mongo:7",
    )
    env.update(extra)
    (tmp_path / "calls.log").write_text("")
    return env


def run(tmp_path, *args, **extra):
    result = subprocess.run(
        [str(SCRIPT), *args], env=environment(tmp_path, **extra), capture_output=True, text=True, timeout=60
    )
    return result, (tmp_path / "calls.log").read_text().splitlines()


def the_run(calls):
    [call] = [call for call in calls if call.startswith("docker run ")]
    return call


def the_container(calls):
    return the_run(calls).split("--name ", 1)[1].split(" ", 1)[0]


def suite_calls(calls):
    return [call for call in calls if call.startswith("python ")]


def removals(calls):
    return [call for call in calls if call.startswith("docker rm -f ")]


def test_the_server_keeps_no_volume_and_is_removed_when_it_stops(tmp_path):
    result, calls = run(tmp_path)

    assert result.returncode == 0, result.stderr
    words = the_run(calls).split()
    assert "--rm" in words
    assert words.count("--tmpfs") == 2
    assert {words[i + 1].split(":")[0] for i, word in enumerate(words) if word == "--tmpfs"} == {
        "/data/db",
        "/data/configdb",
    }
    assert "-v" not in words and "--volume" not in words and "--mount" not in words


def test_the_server_is_the_compose_files_mongodb_on_a_loopback_port_docker_picks(tmp_path):
    # The image is read from docker-compose.yml, so the move to another version changes one line.
    _, calls = run(tmp_path, COMPOSE_MONGO_IMAGE="mongo:99")

    run_call = the_run(calls)
    assert run_call.endswith(" mongo:99 --wiredTigerCacheSizeGB 0.25")
    assert "-p 127.0.0.1::27017" in run_call
    assert "--ulimit nofile=64000:64000" in run_call


def test_the_server_carries_the_team_labels_from_the_environment(tmp_path):
    _, calls = run(tmp_path, TEAM_OWNER="agent-team", TEAM_TASK="T1", TEAM_KIND="gate", TEAM_WORKTREE="/w")

    run_call = the_run(calls)
    for label in (
        "io.github.chanjdaniel.team.owner=agent-team",
        "io.github.chanjdaniel.team.task=T1",
        "io.github.chanjdaniel.team.kind=gate",
        "io.github.chanjdaniel.team.worktree=/w",
        "io.github.chanjdaniel.team.expires=20",
    ):
        assert f"--label {label}" in run_call


def test_the_suite_runs_from_the_back_end_on_that_server_and_may_not_skip(tmp_path):
    _, calls = run(tmp_path)

    [suite] = suite_calls(calls)
    assert suite.startswith("python -m pytest tests/real_mongo | ")
    assert f"cwd={REPO / 'back-end'} " in suite
    assert "uri=mongodb://127.0.0.1:49200/?serverSelectionTimeoutMS=5000 " in suite
    assert suite.endswith("required=true")


def test_arguments_are_pytests_in_place_of_the_whole_package(tmp_path):
    _, calls = run(tmp_path, "tests/real_mongo/test_the_applicant_side_races.py", "-q")

    [suite] = suite_calls(calls)
    assert suite.startswith("python -m pytest tests/real_mongo/test_the_applicant_side_races.py -q | ")


@pytest.mark.parametrize("status", [0, 1, 5])
def test_the_server_is_removed_after_the_suite_and_the_status_is_the_suites(tmp_path, status):
    result, calls = run(tmp_path, PYTEST_STATUS=str(status))

    assert result.returncode == status
    assert removals(calls) == [f"docker rm -f {the_container(calls)}"]
    assert calls.index(removals(calls)[0]) > calls.index(suite_calls(calls)[0])


def test_a_server_that_never_answers_runs_no_suite_and_is_removed(tmp_path):
    result, calls = run(tmp_path, MONGO_SILENT="1")

    assert result.returncode != 0
    assert suite_calls(calls) == []
    assert removals(calls) == [f"docker rm -f {the_container(calls)}"]
    assert "did not answer" in result.stderr


def test_a_killed_run_still_has_its_server_removed(tmp_path):
    # SIGKILL runs no trap, so a guard outside the script's process group removes the server.
    pid_file = tmp_path / "pytest.pid"
    env = environment(tmp_path, PYTEST_HANGS="1", PYTEST_PID=str(pid_file))
    script = subprocess.Popen(
        [str(SCRIPT)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True
    )
    log = tmp_path / "calls.log"
    try:
        deadline = time.monotonic() + 20
        while not pid_file.exists() or not pid_file.read_text().strip():
            assert time.monotonic() < deadline, "the suite never started"
            time.sleep(0.1)
        script.send_signal(signal.SIGKILL)
        script.wait()
        while not removals(log.read_text().splitlines()):
            assert time.monotonic() < deadline + 20, "the server was never removed"
            time.sleep(0.1)
    finally:
        if script.poll() is None:
            script.kill()
        if pid_file.exists() and pid_file.read_text().strip():
            try:
                os.kill(int(pid_file.read_text()), signal.SIGKILL)
            except ProcessLookupError:
                pass

    calls = log.read_text().splitlines()
    assert removals(calls) == [f"docker rm -f {the_container(calls)}"]
