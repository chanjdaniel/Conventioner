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


def test_real_data_already_on_dev_fails_the_run_before_anything_else(tmp_path):
    root = repo_with_scripts(tmp_path)
    (root / "fixture.csv").write_text("Email Address\njordan.vance88@" + "gmail.com\n")
    for args in (
        ["add", "fixture.csv"],
        ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-q", "--no-verify", "-m", "test: fixture"],
        ["update-ref", "refs/remotes/origin/dev", "HEAD"],
    ):
        subprocess.run(["git", *args], cwd=root, check=True, capture_output=True)
    env = {k: v for k, v in os.environ.items() if not k.startswith(("COMPOSE_", "TH_", "TEAM_"))}
    env.update(PYTHON_CMD=sys.executable, TMPDIR=str(tmp_path))

    result = subprocess.run(
        [BASH, str(root / "scripts" / "nm-test.sh")], env=env, capture_output=True, text=True, timeout=60
    )

    assert result.returncode != 0
    assert "fixture.csv:2:" in result.stdout
    assert "jordan.vance88" not in result.stdout + result.stderr
    assert "venv" not in result.stdout + result.stderr


@pytest.fixture
def stubbed(tmp_path):
    """Runs nm-test.sh to its end with every suite, the stack's scripts, npm, npx and docker stubbed,
    each call written to calls.log; returns the run's result and the calls."""
    root = repo_with_scripts(tmp_path)
    calls = tmp_path / "calls.log"
    calls.touch()
    # A stub fails when its whole call is $STUB_FAILS, and npm's lockfile-only install writes
    # $STUB_LOCKFILE into the lockfile when that is set, as a different npm would.
    stub = f'#!{BASH}\necho "$(basename "$0") $*" >>{calls}\n[[ "$(basename "$0") $*" != "${{STUB_FAILS:-}}" ]] || exit 1\n'
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for path in (bin_dir / "npx", bin_dir / "docker", root / "scripts" / "seed_fixture.sh",
                 root / "scripts" / "lock-backend-requirements.sh"):
        path.write_text(stub)
        path.chmod(0o755)
    (bin_dir / "npm").write_text(
        stub + 'if [[ $* == "install --package-lock-only"* && -n ${STUB_LOCKFILE:-} ]]; then\n'
        '  echo "$STUB_LOCKFILE" >package-lock.json\nfi\n'
    )
    (bin_dir / "npm").chmod(0o755)
    # The Node on PATH says it is $STUB_NODE, .nvmrc's unless a test says otherwise.
    (bin_dir / "node").write_text(f'#!{BASH}\necho "${{STUB_NODE:-v24.22.1}}"\n')
    (bin_dir / "node").chmod(0o755)
    (root / "scripts" / "th-compose.sh").write_text(
        stub + 'if [[ $1 == ports ]]; then echo "export TH_MONGO_PORT=1 TH_BACKEND_PORT=2 TH_FRONTEND_PORT=3"; fi\n'
    )
    (root / "scripts" / "th-compose.sh").chmod(0o755)
    for folder in ("back-end", "front-end"):
        (root / folder).mkdir()
    (root / ".nvmrc").write_text("24.22.1\n")
    (root / "front-end" / "package-lock.json").write_text('{"lockfileVersion": 3}\n')
    for args in (
        ["add", "."],
        ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-q", "--no-verify", "-m", "chore: pins"],
        ["update-ref", "refs/remotes/origin/dev", "HEAD"],
    ):
        subprocess.run(["git", *args], cwd=root, check=True, capture_output=True)
    python = tmp_path / "python"
    python.write_text(
        textwrap.dedent(
            f"""\
            #!{BASH}
            if [[ "$1 $2" == "-m venv" ]]; then
              mkdir -p "$3/bin"
              printf '#!{BASH}\\necho "python $*" >>{calls}\\n' >"$3/bin/python"
              chmod +x "$3/bin/python"
              exit 0
            fi
            exec {sys.executable} "$@"
            """
        )
    )
    python.chmod(0o755)
    env = {k: v for k, v in os.environ.items() if not k.startswith(("COMPOSE_", "TH_", "TEAM_", "XDG_"))}
    env.update(
        PYTHON_CMD=str(python),
        TMPDIR=str(tmp_path),
        XDG_STATE_HOME=str(tmp_path / "state"),
        PATH=f"{bin_dir}:{env['PATH']}",
    )

    def run(*args, **stubs):
        result = subprocess.run(
            [BASH, str(root / "scripts" / "nm-test.sh"), *args],
            env={**env, **stubs},
            capture_output=True,
            text=True,
            timeout=60,
        )
        return result, calls.read_text().splitlines()

    return run, tmp_path / "state" / "conventioner" / "e2e.lock"


UNIT_SUITES = [
    "python -m pytest scripts/tests -q",
    "python scripts/knowledge_graph.py check",
    "lock-backend-requirements.sh ",
    "python -m pytest tests/ -v",
    # As CI's frontend-lint-and-types job, in its order.
    "npm ci --engine-strict",
    "npm install --package-lock-only --ignore-scripts --no-audit --no-fund",
    "npm run format:check",
    "npm run lint:check",
    "npm run lint:css",
    "npm run type-check",
    "npm run test:unit",
    "npm run build-only",
    "npm run bundle-budget",
    "npm run no-eval",
]


def suites(calls):
    """The calls but the installs into the run's virtual environment."""
    return [call for call in calls if not call.startswith("python -m pip")]


def test_without_the_switch_the_run_ends_with_playwright_on_a_stack_of_its_own_under_the_lock(stubbed):
    run, lock = stubbed

    result, calls = run()

    assert result.returncode == 0, result.stdout + result.stderr
    assert suites(calls)[: len(UNIT_SUITES)] == UNIT_SUITES
    e2e = suites(calls)[len(UNIT_SUITES) :]
    for call in (
        "npx playwright install chromium",
        "th-compose.sh ensure-images",
        "th-compose.sh up -d",
        "seed_fixture.sh ",
        "npx playwright test",
        "th-compose.sh down -v --remove-orphans",
    ):
        assert call in e2e
    assert "nmtest-" in lock.read_text()
    assert "E2E tests: OK" in result.stdout
    assert "left to CI" not in result.stdout


def test_skip_e2e_runs_every_other_suite_and_leaves_playwright_to_ci(stubbed):
    run, lock = stubbed

    result, calls = run("--skip-e2e")

    assert result.returncode == 0, result.stdout + result.stderr
    assert suites(calls) == UNIT_SUITES
    assert not lock.exists()
    [line] = [line for line in result.stdout.splitlines() if "left to CI" in line]
    assert "Playwright" in line
    assert "E2E tests: OK" not in result.stdout
    assert "===== All tests passed =====" in result.stdout


@pytest.mark.parametrize("check", ["format:check", "lint:check", "lint:css", "type-check"])
def test_a_failing_front_end_check_fails_the_run_before_the_unit_tests(stubbed, check):
    run, _ = stubbed

    result, calls = run("--skip-e2e", STUB_FAILS=f"npm run {check}")

    assert result.returncode != 0
    assert suites(calls)[-1] == f"npm run {check}"
    assert "npm run test:unit" not in calls
    assert "Frontend lint and types: OK" not in result.stdout


def test_the_front_end_checks_pass_with_one_line_before_the_unit_tests(stubbed):
    run, _ = stubbed

    result, _ = run("--skip-e2e")

    assert result.returncode == 0, result.stdout + result.stderr
    out = result.stdout
    assert out.index("===== Frontend Lint and Types =====") < out.index("Frontend lint and types: OK")
    assert out.index("Frontend lint and types: OK") < out.index("===== Frontend Unit Tests =====")


def test_a_node_other_than_nvmrcs_fails_the_run_before_npm_installs(stubbed):
    run, _ = stubbed

    result, calls = run("--skip-e2e", STUB_NODE="v22.1.0")

    assert result.returncode != 0
    assert "nm-test: ERROR: Node is v22.1.0, not v24.22.1 (.nvmrc); run nvm use" in result.stderr
    assert not [call for call in calls if call.startswith("npm ")]


def test_a_lockfile_the_npm_writes_otherwise_fails_the_run_and_is_left_to_read(stubbed, tmp_path):
    run, _ = stubbed

    result, calls = run("--skip-e2e", STUB_LOCKFILE='{"lockfileVersion": 2}')

    assert result.returncode != 0
    assert suites(calls)[-1] == "npm install --package-lock-only --ignore-scripts --no-audit --no-fund"
    assert '+{"lockfileVersion": 2}' in result.stdout
    assert "package-lock.json" in result.stderr
    lock = tmp_path / "repo" / "front-end" / "package-lock.json"
    assert lock.read_text() == '{"lockfileVersion": 2}\n'


def test_an_unknown_argument_fails_the_run_before_anything_runs(stubbed):
    run, lock = stubbed

    result, calls = run("--skip-playwright")

    assert result.returncode != 0
    assert "--skip-playwright" in result.stderr
    assert "--skip-e2e" in result.stderr
    assert "--real-data-only" in result.stderr
    assert calls == []


# An invented applicant, in a fake export the test writes into its repository's .scratch/examples/,
# as the organizers' real exports sit in the checkout's.
LISTED_NAME = "Wren Okafor"
FAKE_EXPORT = f"""\
Timestamp,Email Address,Full name,Business name
9/27/2025 9:04:01,wren.okafor@example.com,{LISTED_NAME},Ember Kiln Pottery
"""


def commit_file(root, name, text, *, on_dev=False):
    (root / name).write_text(text)
    steps = [
        ["add", name],
        ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-q", "--no-verify", "-m", "test: a file"],
    ]
    if on_dev:
        steps.append(["update-ref", "refs/remotes/origin/dev", "HEAD"])
    for args in steps:
        subprocess.run(["git", *args], cwd=root, check=True, capture_output=True)


def with_fake_export(root):
    examples = root / ".scratch" / "examples"
    examples.mkdir(parents=True)
    (examples / "responses.csv").write_text(FAKE_EXPORT)


def real_data_only(root, tmp_path):
    env = {k: v for k, v in os.environ.items() if not k.startswith(("COMPOSE_", "TH_", "TEAM_"))}
    env.update(PYTHON_CMD=sys.executable, TMPDIR=str(tmp_path))
    return subprocess.run(
        [BASH, str(root / "scripts" / "nm-test.sh"), "--real-data-only"],
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )


def test_real_data_only_runs_both_checks_and_no_suite(stubbed):
    run, lock = stubbed

    result, calls = run("--real-data-only")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "checking the branch's commits since origin/dev for real data" in result.stdout
    assert "checking the whole tree for real data" in result.stdout
    assert "Real data: OK" in result.stdout
    assert calls == []
    assert not lock.exists()
    assert result.stdout.splitlines()[-1] == "nm-test: --real-data-only: no suite run; CI runs them."


def test_real_data_only_fails_on_a_listed_name_the_branch_adds(tmp_path):
    root = repo_with_scripts(tmp_path)
    with_fake_export(root)
    commit_file(root, "notes.md", f"Thanks to {LISTED_NAME} for the stall.\n")

    result = real_data_only(root, tmp_path)

    assert result.returncode != 0
    assert "notes.md:1:" in result.stdout
    assert "checking the whole tree" not in result.stdout
    assert "venv" not in result.stdout + result.stderr


def test_real_data_only_fails_on_a_name_listed_since_dev_took_its_file(tmp_path):
    root = repo_with_scripts(tmp_path)
    commit_file(root, "notes.md", f"Thanks to {LISTED_NAME} for the stall.\n", on_dev=True)
    with_fake_export(root)

    result = real_data_only(root, tmp_path)

    assert result.returncode != 0
    assert "checking the whole tree for real data" in result.stdout
    assert "notes.md:1:" in result.stdout
    assert "venv" not in result.stdout + result.stderr
