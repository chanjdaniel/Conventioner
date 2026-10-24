"""nm-test.sh, run from a copy of the scripts on a Python whose virtual environment's interpreter
only says it started and then waits, so a test can abort the run in its first phase as the gate does."""

import os
import shutil
import signal
import subprocess
import sys
import textwrap
import time
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
BASH = shutil.which("bash")


def repo_with_scripts(tmp_path):
    """A git repository holding the scripts, whose dev is on GitHub as origin/dev."""
    root = tmp_path / "repo"
    (root / "scripts").mkdir(parents=True)
    for script in ("nm-test.sh", "e2e-lock.sh", "real_data_check.py"):
        shutil.copy(REPO / "scripts" / script, root / "scripts")
    for args in (
        ["init", "-q", "-b", "dev"],
        ["add", "."],
        ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-q", "--no-verify", "-m", "chore: start"],
        ["update-ref", "refs/remotes/origin/dev", "HEAD"],
    ):
        subprocess.run(["git", *args], cwd=root, check=True, capture_output=True)
    return root


@pytest.fixture
def run(tmp_path):
    """A run of nm-test.sh in a process group of its own, with $TMPDIR the test's own, that has made
    its virtual environment and waits in its first `pip install`; killed whatever is left at the end."""
    root = repo_with_scripts(tmp_path)
    python = tmp_path / "python"
    python.write_text(
        textwrap.dedent(
            f"""\
            #!{BASH}
            if [[ "$1 $2" == "-m venv" ]]; then
              mkdir -p "$3/bin"
              printf '#!{BASH}\\necho "venv python started"\\nexec sleep 600\\n' >"$3/bin/python"
              chmod +x "$3/bin/python"
              exit 0
            fi
            exec {sys.executable} "$@"
            """
        )
    )
    python.chmod(0o755)
    tmp = tmp_path / "tmp"
    tmp.mkdir()
    env = {k: v for k, v in os.environ.items() if not k.startswith(("COMPOSE_", "TH_", "TEAM_"))}
    env.update(PYTHON_CMD=str(python), TMPDIR=str(tmp))
    process = subprocess.Popen(
        [BASH, str(root / "scripts" / "nm-test.sh")],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        start_new_session=True,
    )
    seen = []
    for line in process.stdout:
        seen.append(line)
        if "venv python started" in line:
            break
    else:
        pytest.fail(f"the run never reached its first pip install; got {seen!r}")
    yield process, tmp
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait(timeout=10)


def gone_within(seconds, path):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if not path.exists():
            return True
        time.sleep(0.2)
    return False


def test_a_killed_run_leaves_no_virtual_environment(run):
    process, tmp = run
    [venv] = tmp.glob(f"nmtest-{process.pid}-venv.*")

    # As the gate's abort ends: SIGKILL to the run's whole process group, so no trap runs.
    os.killpg(process.pid, signal.SIGKILL)
    process.wait(timeout=10)

    assert gone_within(10, venv), sorted(p.name for p in tmp.iterdir())


def test_a_branch_adding_real_data_fails_the_run_before_anything_else(tmp_path):
    root = repo_with_scripts(tmp_path)
    (root / "notes.md").write_text("jordan.vance88@" + "gmail.com\n")  # whole, the hooks would refuse this file
    for args in (
        ["add", "notes.md"],
        ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-q", "--no-verify", "-m", "docs: notes"],
    ):
        subprocess.run(["git", *args], cwd=root, check=True, capture_output=True)
    env = {k: v for k, v in os.environ.items() if not k.startswith(("COMPOSE_", "TH_", "TEAM_"))}
    env.update(PYTHON_CMD=sys.executable, TMPDIR=str(tmp_path))

    result = subprocess.run(
        [BASH, str(root / "scripts" / "nm-test.sh")], env=env, capture_output=True, text=True, timeout=60
    )

    assert result.returncode != 0
    assert "notes.md:1:" in result.stdout
    assert "jordan.vance88" not in result.stdout + result.stderr
    assert "venv" not in result.stdout + result.stderr
    assert not list(tmp_path.glob("nmtest-*"))
