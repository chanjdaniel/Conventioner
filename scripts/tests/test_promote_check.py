"""The Promote workflow's check (T317), against a stub GitHub API.

Each test runs the script's command line as the workflow does and reads what the workflow reads:
its exit code and its lines. The stub answers each API path with a scripted sequence, as
test_deploy_proof.py's does, and records every request, so a test can say what was asked and how
often.
"""
import json
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "promote_check.py"

SHA = "3f2c9d1e8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e"
SHORT = SHA[:12]
OLD = "0a1b2c3d4e5f60718293a4b5c6d7e8f901234567"
MAIN = "9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a291807"
MAIN_SHORT = MAIN[:12]
GITHUB_TOKEN = "github-token-not-for-logs"
RUNS = "/repos/owner/repo/actions/workflows/test.yml/runs"
ON_DEV = f"/repos/owner/repo/compare/dev...{SHA}"
FROM_MAIN = f"/repos/owner/repo/compare/main...{SHA}"
RUN_URL = "https://github.com/owner/repo/actions/runs/9041"

DROP = "drop"


class Stub:
    """An HTTP server whose answers per path are a scripted sequence; the last answer repeats."""

    def __init__(self):
        self.routes = {}
        self.requests = []
        stub = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                parts = urlsplit(self.path)
                stub.requests.append((parts.path, parse_qs(parts.query), {k.lower(): v for k, v in self.headers.items()}))
                answers = stub.routes.get(parts.path)
                if answers is None:
                    answer = (404, "not found")
                else:
                    answer = answers.pop(0) if len(answers) > 1 else answers[0]
                if answer == DROP:
                    self.close_connection = True
                    return
                status, body = answer
                data = body.encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.origin = f"http://127.0.0.1:{self.server.server_port}"
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)

    def serve(self, path, *answers):
        self.routes[path] = list(answers)

    def count(self, path):
        return sum(1 for requested, _, _ in self.requests if requested == path)


@pytest.fixture
def stub():
    server = Stub()
    server.thread.start()
    yield server
    server.server.shutdown()
    server.server.server_close()


@pytest.fixture
def env(tmp_path, stub):
    return {
        "PATH": "/usr/bin:/bin",
        "HOME": str(tmp_path),
        "GITHUB_API_URL": stub.origin,
        "GITHUB_REPOSITORY": "owner/repo",
        "GITHUB_TOKEN": GITHUB_TOKEN,
    }


def run(env, *args):
    result = subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    return result.returncode, result.stdout + result.stderr


def check(env, commit=SHA):
    return run(env, "--commit", commit)


def errors(output):
    return [line for line in output.splitlines() if line.startswith("::error::")]


def run_of(number, status="completed", conclusion="success", head_sha=SHA, branch="dev", event="push"):
    return {
        "run_number": number,
        "status": status,
        "conclusion": conclusion,
        "head_sha": head_sha,
        "event": event,
        "head_branch": branch,
        "html_url": f"https://github.com/owner/repo/actions/runs/{9000 + number}",
    }


def runs(*items):
    return (200, json.dumps({"total_count": len(items), "workflow_runs": list(items)}))


def compared(status, ahead_by=0, behind_by=0, base=MAIN):
    return (200, json.dumps({
        "status": status,
        "ahead_by": ahead_by,
        "behind_by": behind_by,
        "base_commit": {"sha": base},
        "merge_base_commit": {"sha": OLD},
        "commits": [],
    }))


def promotable(stub, *, test=None, on_dev=None, from_main=None):
    """Every read answered as for a commit that may be promoted, unless a test says otherwise."""
    stub.serve(RUNS, test or runs(run_of(41)))
    stub.serve(ON_DEV, on_dev or compared("behind", behind_by=2))
    stub.serve(FROM_MAIN, from_main or compared("ahead", ahead_by=3))


# The pass


def test_a_green_dev_commit_main_is_behind_may_be_promoted(stub, env):
    promotable(stub)

    code, output = check(env)

    assert code == 0
    assert errors(output) == []
    assert output.splitlines() == [
        f"{SHORT} may be promoted: Test passed on dev ({RUN_URL}), and main ({MAIN_SHORT}) is 3 commits behind it."
    ]


def test_dev_s_own_tip_may_be_promoted(stub, env):
    promotable(stub, on_dev=compared("identical"))

    code, output = check(env)

    assert code == 0
    assert f"{SHORT} may be promoted" in output


def test_one_commit_behind_reads_as_one_commit(stub, env):
    promotable(stub, from_main=compared("ahead", ahead_by=1))

    code, output = check(env)

    assert code == 0
    assert output.splitlines()[-1].endswith(f"and main ({MAIN_SHORT}) is 1 commit behind it.")


def test_an_upper_case_sha_is_read_as_lower_case(stub, env):
    promotable(stub)

    code, output = check(env, SHA.upper())

    assert code == 0
    assert stub.count(ON_DEV) == 1
    assert stub.count(FROM_MAIN) == 1


# The Test run on a push to dev


def test_a_commit_with_no_run_is_refused(stub, env):
    promotable(stub, test=runs())

    code, output = check(env)

    assert code == 1
    assert errors(output) == [
        f"::error::No Test run on a push to dev at {SHORT}. Promote only a commit on dev whose Test run has passed."
    ]


def test_a_run_still_going_is_refused(stub, env):
    promotable(stub, test=runs(run_of(41, status="in_progress", conclusion=None)))

    code, output = check(env)

    assert code == 1
    assert errors(output) == [
        f"::error::Test is still running on dev at {SHORT} ({RUN_URL}). Run Promote again once it has passed."
    ]


@pytest.mark.parametrize("conclusion", ["failure", "cancelled", "timed_out"])
def test_a_run_that_did_not_pass_is_refused(stub, env, conclusion):
    promotable(stub, test=runs(run_of(41, conclusion=conclusion)))

    code, output = check(env)

    assert code == 1
    assert errors(output) == [
        f"::error::Test {conclusion} on dev at {SHORT} ({RUN_URL}). Promote only a commit whose Test run has passed."
    ]


@pytest.mark.parametrize(
    ("older", "newer", "passes"),
    [("success", "failure", False), ("failure", "success", True)],
)
@pytest.mark.parametrize("listed_newest_first", [True, False])
def test_the_newest_run_decides(stub, env, older, newer, passes, listed_newest_first):
    pair = [run_of(41, conclusion=older), run_of(42, conclusion=newer)]
    promotable(stub, test=runs(*(reversed(pair) if listed_newest_first else pair)))

    code, output = check(env)

    assert code == (0 if passes else 1)
    assert "actions/runs/9042" in output


@pytest.mark.parametrize(
    "other",
    [
        run_of(42, head_sha=OLD),
        run_of(42, branch="main"),
        run_of(42, branch="feat/something"),
        run_of(42, event="pull_request"),
        run_of(42, event="workflow_dispatch"),
    ],
    ids=["another-commit", "main", "a-feature-branch", "a-pull-request", "a-dispatch"],
)
def test_a_run_of_another_commit_branch_or_event_is_not_counted(stub, env, other):
    promotable(stub, test=runs(other))

    code, output = check(env)

    assert code == 1
    assert errors(output)[0].startswith(f"::error::No Test run on a push to dev at {SHORT}.")


def test_a_passing_run_elsewhere_does_not_outvote_dev_s_failed_one(stub, env):
    promotable(stub, test=runs(run_of(41, conclusion="failure"), run_of(42, event="pull_request")))

    code, output = check(env)

    assert code == 1
    assert errors(output) == [
        f"::error::Test failure on dev at {SHORT} ({RUN_URL}). Promote only a commit whose Test run has passed."
    ]


def test_a_refused_run_compares_nothing(stub, env):
    promotable(stub, test=runs(run_of(41, conclusion="failure")))

    check(env)

    assert stub.count(ON_DEV) == 0
    assert stub.count(FROM_MAIN) == 0


def test_it_asks_for_this_commit_on_a_push_to_dev_with_the_token(stub, env):
    promotable(stub)

    code, output = check(env)

    assert code == 0
    assert [path for path, _, _ in stub.requests] == [RUNS, ON_DEV, FROM_MAIN]
    _, query, _ = stub.requests[0]
    assert query == {"head_sha": [SHA], "event": ["push"], "branch": ["dev"], "per_page": ["100"]}
    for _, _, headers in stub.requests:
        assert headers["authorization"] == f"Bearer {GITHUB_TOKEN}"
        assert headers["accept"] == "application/vnd.github+json"
        assert headers["x-github-api-version"] == "2022-11-28"
    assert GITHUB_TOKEN not in output


# On dev


@pytest.mark.parametrize("status", ["ahead", "diverged"])
def test_a_commit_not_on_dev_is_refused(stub, env, status):
    promotable(stub, on_dev=compared(status, ahead_by=1))

    code, output = check(env)

    assert code == 1
    assert errors(output) == [f"::error::{SHORT} is not on dev. Promote only a commit on dev."]
    assert stub.count(FROM_MAIN) == 0


# main is its ancestor


def test_a_commit_main_is_already_at_is_refused(stub, env):
    promotable(stub, from_main=compared("identical"))

    code, output = check(env)

    assert code == 1
    assert errors(output) == [f"::error::main is already at {SHORT}; nothing to promote."]


def test_a_commit_older_than_main_is_refused(stub, env):
    promotable(stub, from_main=compared("behind", behind_by=4))

    code, output = check(env)

    assert code == 1
    assert errors(output) == [f"::error::{SHORT} is older than main ({MAIN_SHORT}); nothing to promote."]


def test_a_commit_main_has_diverged_from_is_refused_naming_the_merge_back(stub, env):
    promotable(stub, from_main=compared("diverged", ahead_by=3, behind_by=1))

    code, output = check(env)

    assert code == 1
    assert errors(output) == [
        f"::error::main ({MAIN_SHORT}) has commits {SHORT} lacks, so main cannot be fast-forwarded to it."
        " If it is the release commit, merge main back into dev first (docs/RELEASING.md, step 6),"
        " then promote a dev commit that has it."
    ]


# Fails closed


READS = [
    (RUNS, f"the Test runs for {SHORT}"),
    (ON_DEV, f"the comparison of {SHORT} with dev"),
    (FROM_MAIN, f"the comparison of {SHORT} with main"),
]


@pytest.mark.parametrize(("path", "what"), READS, ids=["runs", "on-dev", "from-main"])
def test_an_api_error_refuses_with_no_retry(stub, env, path, what):
    promotable(stub)
    stub.serve(path, (500, "upstream broke"))

    code, output = check(env)

    assert code == 1
    assert errors(output) == [f"::error::Could not read {what} from GitHub (500), so nothing was promoted."]
    assert stub.count(path) == 1
    assert "may be promoted" not in output


@pytest.mark.parametrize(("path", "what"), READS, ids=["runs", "on-dev", "from-main"])
def test_no_answer_refuses_with_no_retry(stub, env, path, what):
    promotable(stub)
    stub.serve(path, DROP)

    code, output = check(env)

    assert code == 1
    [error] = errors(output)
    assert error.startswith(f"::error::Could not read {what} from GitHub (")
    assert error.endswith("), so nothing was promoted.")
    assert "(500)" not in error
    assert stub.count(path) == 1


@pytest.mark.parametrize(
    ("path", "answer"),
    [
        (RUNS, (200, "not json")),
        (RUNS, (200, json.dumps({"runs": []}))),
        (ON_DEV, (200, json.dumps({"status": "sideways"}))),
        (FROM_MAIN, (200, json.dumps({"status": "unknown", "ahead_by": 1, "base_commit": {"sha": MAIN}}))),
        (FROM_MAIN, (200, json.dumps({"status": "ahead", "base_commit": {"sha": MAIN}}))),
        (FROM_MAIN, (200, json.dumps({"status": "ahead", "ahead_by": 3}))),
    ],
    ids=["runs-not-json", "runs-unlike-github", "on-dev-unknown-status", "from-main-unknown-status",
         "from-main-without-count", "from-main-without-main"],
)
def test_an_answer_unlike_github_s_refuses(stub, env, path, answer):
    promotable(stub)
    stub.serve(path, answer)

    code, output = check(env)

    assert code == 1
    [error] = errors(output)
    assert error.startswith("::error::Could not read ")
    assert error.endswith(", so nothing was promoted.")


# Usage


@pytest.mark.parametrize(
    "commit",
    [SHA[:12], SHA + "0", SHA[:39] + "g", "", "dev", "HEAD~1", " " + SHA[:39]],
    ids=["short", "long", "not-hexadecimal", "empty", "a-branch", "a-revision", "padded"],
)
def test_anything_but_a_full_sha_is_a_usage_error_before_any_request(stub, env, commit):
    code, output = check(env, commit)

    assert code == 2
    assert f"--commit takes a commit's full 40-character sha, not {commit}" in output
    assert stub.requests == []


def test_a_long_commit_is_shown_cut_to_80_characters(stub, env):
    given = "a" * 200

    code, output = check(env, given)

    assert code == 2
    assert f"not {'a' * 80}" in output
    assert "a" * 81 not in output


@pytest.mark.parametrize("missing", ["GITHUB_TOKEN", "GITHUB_REPOSITORY"])
def test_it_needs_its_environment(stub, env, missing):
    del env[missing]

    code, output = check(env)

    assert code == 2
    assert missing in output
    assert stub.requests == []


def test_it_needs_a_commit(stub, env):
    code, output = run(env)

    assert code == 2
    assert "--commit" in output
    assert stub.requests == []
