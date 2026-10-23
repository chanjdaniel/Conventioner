"""e2e-lock.sh, sourced by real Bash processes that take turns for the lock, with flock and without."""

import os
import shutil
import queue
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
LIBRARY = REPO / "scripts" / "e2e-lock.sh"
BASH = shutil.which("bash")

# A run that takes the lock, says so, and keeps it until its stdin closes.
HOLD = f"""
source {LIBRARY}
take_e2e_lock "$WAIT" "$WHO"
echo held
read -r _ || true  # until stdin closes
"""


@pytest.fixture(params=["flock", "python"])
def env(request, tmp_path):
    """The lock under a state home of the test's own, taken with flock(1), or with Python's fcntl
    on a PATH that has no flock."""
    if request.param == "flock" and not shutil.which("flock"):
        pytest.skip("flock is not installed")
    env = {k: v for k, v in os.environ.items() if not k.startswith(("XDG_", "E2E_"))}
    env.update(XDG_STATE_HOME=str(tmp_path / "state"), PYTHON=sys.executable, WAIT="10")
    if request.param == "python":
        bin_dir = tmp_path / "bin"
        bin_dir.mkdir()
        for tool in ("mkdir", "sleep"):
            (bin_dir / tool).symlink_to(shutil.which(tool))
        env["PATH"] = str(bin_dir)
    return env


class Run:
    """A Bash process in a session of its own, whose output lines are read as they come."""

    def __init__(self, env, script, who):
        self.process = subprocess.Popen(
            [BASH, "-c", script],
            env={**env, "WHO": who},
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            start_new_session=True,
        )
        self.lines = queue.Queue()
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        for line in self.process.stdout:
            self.lines.put(line)
        self.lines.put(None)

    def wait_for(self, text, timeout=10):
        """The lines up to the first that contains `text`."""
        seen = []
        deadline = time.monotonic() + timeout
        while (left := deadline - time.monotonic()) > 0:
            try:
                line = self.lines.get(timeout=left)
            except queue.Empty:
                break
            if line is None:
                break
            seen.append(line)
            if text in line:
                return seen
        pytest.fail(f"no line with {text!r} within {timeout} s; got {seen!r}")

    def rest(self, timeout=10):
        """Every line until the process exits, and its exit status."""
        status = self.process.wait(timeout=timeout)
        seen = []
        while (line := self.lines.get(timeout=timeout)) is not None:
            seen.append(line)
        return "".join(seen), status

    def release(self):
        self.process.stdin.close()
        return self.process.wait(timeout=10)

    def kill(self):
        try:
            os.killpg(self.process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        self.process.wait(timeout=10)


@pytest.fixture
def runs(env):
    """Starts runs, and kills whatever of them is left when the test ends."""
    started = []

    def start(script, who, **extra):
        run = Run({**env, **extra}, script, who)
        started.append(run)
        return run

    yield start
    for run in started:
        run.kill()


def test_an_unheld_lock_is_taken_at_once_and_its_directory_made(runs, tmp_path):
    holder = runs(HOLD, "nmtest-1 (pid 1, /work/a)")

    lines = holder.wait_for("held")

    assert len(lines) == 2 and "nm-test: has the end-to-end lock at " in lines[0]
    lock = tmp_path / "state" / "conventioner" / "e2e.lock"
    assert lock.read_text().startswith("nmtest-1 (pid 1, /work/a) since ")
    assert holder.release() == 0


def test_a_second_run_waits_saying_for_whom_and_takes_the_lock_once_it_is_free(runs):
    first = runs(HOLD, "nmtest-1 (pid 1, /work/a)")
    first.wait_for("held")

    second = runs(HOLD, "nmtest-2 (pid 2, /work/b)")
    waiting = second.wait_for("waiting")

    assert "nm-test: waiting for the end-to-end lock since " in waiting[-1]
    assert "held by nmtest-1 (pid 1, /work/a) since " in waiting[-1]
    assert second.process.poll() is None
    assert first.release() == 0
    assert "nm-test: has the end-to-end lock at " in second.wait_for("held")[0]
    assert second.release() == 0


def test_a_run_that_waits_too_long_fails_saying_so(runs):
    first = runs(HOLD, "nmtest-1 (pid 1, /work/a)")
    first.wait_for("held")

    second = runs(f"source {LIBRARY}; take_e2e_lock 2 \"$WHO\"", "nmtest-2 (pid 2, /work/b)")
    out, status = second.rest()

    assert status == 1
    assert out.splitlines()[-1] == "nm-test: ERROR: no end-to-end slot within 2 seconds"
    assert first.release() == 0


def test_the_wait_is_named_in_minutes_when_it_is_whole_minutes(runs):
    out, _ = runs(f"source {LIBRARY}; e2e_lock_span 2700", "").rest()

    assert out == "45 minutes\n"


# A child that outlives the run in a process group of its own, as the teardown guard does,
# until the test creates `done`.
CHILD = "( until [[ -e {done} ]]; do sleep 0.1; done ) </dev/null >/dev/null 2>&1 &"


def test_a_killed_run_keeps_the_lock_until_the_child_it_handed_it_to_is_done(runs, tmp_path):
    # The teardown guard inherits the descriptor, so the lock outlives the run until the stack is down.
    done = tmp_path / "guard-done"
    first = runs(
        f"""
source {LIBRARY}
take_e2e_lock "$WAIT" "$WHO"
set -m
{CHILD.format(done=done)}
set +m
echo held
read -r _ || true  # until stdin closes
""",
        "nmtest-1 (pid 1, /work/a)",
    )
    try:
        first.wait_for("held")
        second = runs(HOLD, "nmtest-2 (pid 2, /work/b)")
        second.wait_for("waiting")

        first.kill()
        time.sleep(2)
        assert second.process.poll() is None
        assert second.lines.empty()
    finally:
        done.touch()
    assert "nm-test: has the end-to-end lock at " in second.wait_for("held")[0]
    assert second.release() == 0


def test_a_command_run_without_the_lock_does_not_hold_it_after_the_run(runs, tmp_path):
    # A stray child of the run, such as a browser Playwright left behind, must never keep the lock.
    done = tmp_path / "stray-done"
    first = runs(
        f"""
source {LIBRARY}
take_e2e_lock "$WAIT" "$WHO"
without_e2e_lock "$BASH" -c 'set -m; {CHILD.format(done=done)}'
echo held
read -r _ || true  # until stdin closes
""",
        "nmtest-1 (pid 1, /work/a)",
    )
    try:
        first.wait_for("held")
        second = runs(HOLD, "nmtest-2 (pid 2, /work/b)")
        second.wait_for("waiting")

        first.kill()
        assert "nm-test: has the end-to-end lock at " in second.wait_for("held")[0]
        assert second.release() == 0
    finally:
        done.touch()
