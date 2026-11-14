"""The Promote workflow and its check (T317).

The check's tests run the script's command line as the workflow does, against a stub GitHub API,
and read what the workflow reads: its exit code and its lines. The stub answers each API path with
a scripted sequence, as test_deploy_proof.py's does, and records every request, so a test can say
what was asked and how often.

The workflow's tests read .github/workflows/promote.yml as text, and run its steps' shell as the
runner runs it (`bash -e`) with a fake `gh` on PATH.
"""
import json
import os
import re
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


# The Promote workflow, read as text: the job that runs this file has no YAML library.

WORKFLOW = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "promote.yml"

ORDER = [
    "actions/checkout",
    "Refuse to run half-configured",
    "The commit may be promoted",
    "actions/create-github-app-token",
    "Fast-forward main",
    "Say what happened",
]

APP_TOKEN = "${{ steps.app.outputs.token }}"
PINNED = re.compile(r"^[\w.-]+/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$")


def mapping(lines, indent):
    """The `key: value` pairs written at exactly `indent` spaces."""
    pairs = {}
    for line in lines:
        if line.startswith(" " * indent) and not line[indent:].startswith((" ", "#", "- ")) and ":" in line:
            key, _, value = line[indent:].partition(":")
            pairs[key] = value.split(" # ")[0].strip()
    return pairs


def block(lines, start, indent):
    """The lines after `start` indented deeper than `indent`, up to the first one that is not."""
    out = []
    for line in lines[start + 1:]:
        if line.strip() and len(line) - len(line.lstrip()) <= indent:
            break
        out.append(line)
    return out


def at(lines, text):
    return lines.index(text)


def workflow():
    lines = WORKFLOW.read_text().splitlines()
    job = block(lines, at(lines, "  promote:"), 2)
    steps_at = at(job, "    steps:")
    starts = [i for i, line in enumerate(job) if line.startswith("      - ")]
    steps = []
    for n, start in enumerate(starts):
        end = starts[n + 1] if n + 1 < len(starts) else len(job)
        body = ["        " + job[start][8:]] + job[start + 1:end]
        keys = mapping(body, 8)
        step = {"name": keys.get("name"), "id": keys.get("id"), "if": keys.get("if"), "uses": keys.get("uses"),
                "env": {}, "with": {}, "run": "", "text": "\n".join(body)}
        step["title"] = keys["uses"].split("@")[0] if "uses" in keys else step["name"]
        for i, line in enumerate(body):
            if line == "        env:":
                step["env"] = mapping(block(body, i, 8), 10)
            if line == "        with:":
                step["with"] = mapping(block(body, i, 8), 10)
            if line.startswith("        run:"):
                inline = line[len("        run:"):].strip()
                if inline == "|":
                    step["run"] = "\n".join(l[10:] for l in block(body, i, 8)).strip() + "\n"
                else:
                    step["run"] = inline + "\n"
        steps.append(step)
    on = block(lines, at(lines, "on:"), 0)
    inputs = block(on, at(on, "    inputs:"), 4)
    return {
        "lines": lines,
        "top": mapping(lines, 0),
        "on": mapping(on, 2),
        "inputs": {name: mapping(block(inputs, at(inputs, f"      {name}:"), 6), 8) for name in mapping(inputs, 6)},
        "concurrency": mapping(block(lines, at(lines, "concurrency:"), 0), 2),
        "job": mapping(job[:steps_at], 4),
        "job_permissions": mapping(block(job, at(job, "    permissions:"), 4), 6),
        "steps": steps,
    }


def step_named(title):
    return next(step for step in workflow()["steps"] if step["title"] == title)


def test_promote_starts_only_by_hand_with_a_commit_and_a_check_only_switch():
    flow = workflow()

    assert flow["top"]["name"] == "Promote"
    assert flow["on"] == {"workflow_dispatch": ""}
    assert flow["inputs"] == {
        "commit": {
            "description": '"The full 40-character sha of the dev commit to promote"',
            "required": "true",
            "type": "string",
        },
        "check-only": {
            "description": "\"Make every check and mint the App's token, but move nothing\"",
            "type": "boolean",
            "default": "false",
        },
    }


def test_the_run_s_own_token_may_read_the_code_and_the_test_runs_and_nothing_more():
    flow = workflow()

    assert flow["top"]["permissions"] == "{}"
    assert flow["job_permissions"] == {"contents": "read", "actions": "read"}
    assert "env" not in flow["top"]


def test_one_promotion_runs_at_a_time_and_is_never_cancelled_part_way():
    assert workflow()["concurrency"] == {"group": "promote", "cancel-in-progress": "false"}


def test_the_job_runs_only_from_dev_in_the_promote_environment():
    job = workflow()["job"]

    assert job["if"] == "github.ref == 'refs/heads/dev'"
    assert job["environment"] == "promote"
    assert "env" not in job


def test_promote_runs_its_steps_in_order():
    assert [step["title"] for step in workflow()["steps"]] == ORDER


def test_every_action_is_pinned_by_its_full_sha_with_its_version_beside_it():
    used = [line.strip()[len("- uses: "):] for line in workflow()["lines"] if line.strip().startswith("- uses: ")]

    assert len(used) == 2
    for uses in used:
        assert PINNED.match(uses), uses
    assert any(uses.startswith("actions/create-github-app-token@") and " # v3." in uses for uses in used)


def test_the_checkout_keeps_no_credentials():
    assert step_named("actions/checkout")["with"] == {"persist-credentials": "false"}


def test_the_check_runs_the_script_on_the_commit_given_with_the_runs_own_token():
    step = step_named("The commit may be promoted")

    assert step["run"] == 'python3 scripts/promote_check.py --commit "$COMMIT"\n'
    assert step["env"] == {"COMMIT": "${{ inputs.commit }}", "GITHUB_TOKEN": "${{ github.token }}"}
    assert step["if"] is None


def test_the_app_s_token_asks_only_to_write_this_repository_s_contents_and_workflow_files():
    # GitHub refuses an App's ref update that changes a file under .github/workflows/ unless its
    # token may write workflows, and a promotion often carries a workflow change.
    step = step_named("actions/create-github-app-token")

    assert step["id"] == "app"
    assert step["if"] is None
    assert step["with"] == {
        "client-id": "${{ vars.PROMOTE_APP_CLIENT_ID }}",
        "private-key": "${{ secrets.PROMOTE_APP_PRIVATE_KEY }}",
        "repositories": "Conventioner",
        "permission-contents": "write",
        "permission-workflows": "write",
    }


def test_only_the_fast_forward_holds_the_app_s_token():
    flow = workflow()
    holders = [step["title"] for step in flow["steps"] if "steps.app.outputs.token" in step["text"]]

    assert holders == ["Fast-forward main"]
    assert step_named("Fast-forward main")["env"]["GH_TOKEN"] == APP_TOKEN
    assert sum("steps.app.outputs.token" in line for line in flow["lines"]) == 1


def test_only_the_token_step_holds_the_private_key():
    flow = workflow()
    holders = [step["title"] for step in flow["steps"] if "secrets.PROMOTE_APP_PRIVATE_KEY" in step["text"]]

    assert holders == ["Refuse to run half-configured", "actions/create-github-app-token"]
    assert step_named("Refuse to run half-configured")["env"]["HAS_APP_PRIVATE_KEY"] == (
        "${{ secrets.PROMOTE_APP_PRIVATE_KEY != '' }}"
    )


def test_the_fast_forward_never_forces_and_is_skipped_on_a_check_only_run():
    step = step_named("Fast-forward main")

    assert step["id"] == "fast-forward"
    assert step["if"] == "${{ !inputs.check-only }}"
    assert "--method PATCH" in step["run"]
    assert "-F force=false" in step["run"]
    assert "force=true" not in step["run"]
    assert step["env"] == {"GH_TOKEN": APP_TOKEN, "COMMIT": "${{ inputs.commit }}"}


def test_the_summary_is_written_whatever_happened():
    step = step_named("Say what happened")

    assert step["if"] == "always()"
    assert step["env"] == {
        "COMMIT": "${{ inputs.commit }}",
        "CHECK_ONLY": "${{ inputs.check-only }}",
        "TOKEN_MINTED": "${{ steps.app.outcome }}",
        "MOVE": "${{ steps.fast-forward.outcome }}",
        "MAIN_NOW": "${{ steps.fast-forward.outputs.main }}",
    }


def test_no_run_script_holds_an_expression():
    for step in workflow()["steps"]:
        assert "${{" not in step["run"], step["title"]


# The workflow's own shell, run as the runner runs it (`bash -e`), with a fake gh.

FAKE_GH = """#!/bin/sh
printf '%s\\037' "$@" >> "$FAKE_CALLS_LOG"
printf '\\n' >> "$FAKE_CALLS_LOG"
printf 'GH_TOKEN=%s\\n' "$GH_TOKEN" >> "$FAKE_CALLS_LOG"
if [ "$1 $2 $3" = "api --method PATCH" ]; then
  printf '%s' "$FAKE_PATCH_STDOUT"
  printf '%s' "$FAKE_PATCH_STDERR" >&2
  exit "${FAKE_PATCH_EXIT:-0}"
fi
if [ -n "$FAKE_READ_FAILS" ]; then
  echo '{"message":"Server Error","status":"500"}'
  echo 'gh: Server Error (HTTP 500)' >&2
  exit 1
fi
printf '%s\\n' "$FAKE_MAIN"
"""

NOT_A_FAST_FORWARD = (
    '{"message":"Update is not a fast forward",'
    '"documentation_url":"https://docs.github.com/rest/git/refs#update-a-reference","status":"422"}'
)
RULE_VIOLATION = (
    '{"message":"Repository rule violations found\\n\\nRequired status check \\"e2e\\" is expected.\\n\\n",'
    '"documentation_url":"https://docs.github.com/rest/git/refs#update-a-reference","status":"422"}'
)
APP_SECRET = "ghs_app-token-not-for-logs"
MOVED_LINE = "::error::main moved since the check, so nothing was promoted. Run Promote again."


def run_step(tmp_path, step, **extra):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    fake = bin_dir / "gh"
    fake.write_text(FAKE_GH)
    fake.chmod(0o755)
    script = tmp_path / "step.sh"
    script.write_text(step["run"])
    outputs = tmp_path / "outputs"
    outputs.write_text("")
    summary = tmp_path / "summary"
    summary.write_text("")
    runner_temp = tmp_path / "runner-temp"
    runner_temp.mkdir(exist_ok=True)
    env = {
        "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
        "HOME": str(tmp_path),
        "FAKE_CALLS_LOG": str(tmp_path / "calls.log"),
        "GITHUB_REPOSITORY": "owner/repo",
        "GITHUB_OUTPUT": str(outputs),
        "GITHUB_STEP_SUMMARY": str(summary),
        "RUNNER_TEMP": str(runner_temp),
        **extra,
    }
    result = subprocess.run(["bash", "-e", str(script)], env=env, capture_output=True, text=True, timeout=30)
    return result.returncode, result.stdout + result.stderr, outputs.read_text(), summary.read_text()


def gh_calls(tmp_path):
    log = tmp_path / "calls.log"
    calls = []
    for line in (log.read_text() if log.exists() else "").splitlines():
        if line.startswith("GH_TOKEN="):
            calls[-1]["token"] = line[len("GH_TOKEN="):]
        else:
            calls.append({"args": line.split("\x1f")[:-1]})
    return calls


def fast_forward(tmp_path, commit=SHA, **fakes):
    return run_step(tmp_path, step_named("Fast-forward main"), GH_TOKEN=APP_SECRET, COMMIT=commit, **fakes)


def test_the_fast_forward_moves_main_to_the_commit_and_reads_it_back(tmp_path):
    code, output, outputs, _ = fast_forward(tmp_path, FAKE_MAIN=SHA)

    assert code == 0
    assert errors(output) == []
    assert outputs == f"main={SHA}\n"
    calls = gh_calls(tmp_path)
    assert [call["args"] for call in calls] == [
        ["api", "--method", "PATCH", "repos/owner/repo/git/refs/heads/main", "-f", f"sha={SHA}", "-F", "force=false"],
        ["api", "repos/owner/repo/git/ref/heads/main", "--jq", ".object.sha"],
    ]
    assert all(call["token"] == APP_SECRET for call in calls)
    assert APP_SECRET not in output


def test_an_upper_case_commit_is_sent_lower_case(tmp_path):
    code, _, outputs, _ = fast_forward(tmp_path, SHA.upper(), FAKE_MAIN=SHA)

    assert code == 0
    assert gh_calls(tmp_path)[0]["args"][5] == f"sha={SHA}"
    assert outputs == f"main={SHA}\n"


def test_a_main_that_moved_since_the_check_is_refused_not_rewritten(tmp_path):
    code, output, outputs, _ = fast_forward(
        tmp_path,
        FAKE_MAIN=OLD,
        FAKE_PATCH_EXIT="1",
        FAKE_PATCH_STDOUT=NOT_A_FAST_FORWARD,
        FAKE_PATCH_STDERR="gh: Update is not a fast forward (HTTP 422)\n",
    )

    assert code == 1
    assert errors(output) == [MOVED_LINE]
    assert outputs == f"main={OLD}\n"


def test_another_refusal_is_named_and_main_is_said_not_to_have_moved(tmp_path):
    code, output, outputs, _ = fast_forward(
        tmp_path,
        FAKE_MAIN=OLD,
        FAKE_PATCH_EXIT="1",
        FAKE_PATCH_STDOUT=RULE_VIOLATION,
        FAKE_PATCH_STDERR="gh: Repository rule violations found (HTTP 422)\n",
    )

    assert code == 1
    assert errors(output) == [
        "::error::GitHub refused to move main (gh: Repository rule violations found (HTTP 422)), so nothing was promoted."
    ]
    assert "Required status check" in output
    assert outputs == f"main={OLD}\n"


def test_a_read_back_of_another_sha_fails(tmp_path):
    code, output, outputs, _ = fast_forward(tmp_path, FAKE_MAIN=OLD)

    assert code == 1
    assert errors(output) == [f"::error::main is at {OLD} after the move, not {SHA}."]
    assert outputs == f"main={OLD}\n"


def test_a_read_back_that_fails_fails_and_says_main_is_unknown(tmp_path):
    code, output, outputs, _ = fast_forward(tmp_path, FAKE_READ_FAILS="1")

    assert code == 1
    assert errors(output) == [
        f"::error::main could not be read back after the move, so it may be at {SHA} or where it was."
    ]
    assert outputs == "main=\n"


def test_a_move_github_took_although_its_answer_was_lost_is_a_promotion(tmp_path):
    code, output, outputs, _ = fast_forward(
        tmp_path, FAKE_MAIN=SHA, FAKE_PATCH_EXIT="1", FAKE_PATCH_STDERR="gh: Post: net/http: timeout\n"
    )

    assert code == 0
    assert errors(output) == []
    assert outputs == f"main={SHA}\n"


def half_configured(tmp_path, **env):
    return run_step(tmp_path, step_named("Refuse to run half-configured"), **env)


def test_a_configured_run_goes_on(tmp_path):
    code, output, _, _ = half_configured(tmp_path, PROMOTE_APP_CLIENT_ID="Iv23liClientId", HAS_APP_PRIVATE_KEY="true")

    assert code == 0
    assert errors(output) == []


def test_each_missing_setting_is_its_own_error(tmp_path):
    code, output, _, _ = half_configured(tmp_path, PROMOTE_APP_CLIENT_ID="", HAS_APP_PRIVATE_KEY="false")

    assert code == 1
    assert errors(output) == [
        "::error::PROMOTE_APP_CLIENT_ID is not set in the promote environment",
        "::error::PROMOTE_APP_PRIVATE_KEY is not set in the promote environment",
    ]


@pytest.mark.parametrize(
    "client_id,has_key,missing",
    [("", "true", "PROMOTE_APP_CLIENT_ID"), ("Iv23liClientId", "false", "PROMOTE_APP_PRIVATE_KEY")],
)
def test_one_missing_setting_refuses(tmp_path, client_id, has_key, missing):
    code, output, _, _ = half_configured(tmp_path, PROMOTE_APP_CLIENT_ID=client_id, HAS_APP_PRIVATE_KEY=has_key)

    assert code == 1
    assert errors(output) == [f"::error::{missing} is not set in the promote environment"]


def test_the_half_configured_check_reads_the_variable_and_whether_the_secret_is_set():
    step = step_named("Refuse to run half-configured")

    assert step["env"] == {
        "PROMOTE_APP_CLIENT_ID": "${{ vars.PROMOTE_APP_CLIENT_ID }}",
        "HAS_APP_PRIVATE_KEY": "${{ secrets.PROMOTE_APP_PRIVATE_KEY != '' }}",
    }


def summary(tmp_path, commit=SHA, check_only="false", token="success", move="success", main_now=SHA):
    code, output, _, written = run_step(
        tmp_path,
        step_named("Say what happened"),
        COMMIT=commit,
        CHECK_ONLY=check_only,
        TOKEN_MINTED=token,
        MOVE=move,
        MAIN_NOW=main_now,
    )
    assert code == 0, output
    return written.splitlines()


def test_a_promotion_s_summary_says_what_main_is_and_what_comes_next(tmp_path):
    assert summary(tmp_path) == [
        f"### main is now `{SHA}`",
        "The Test workflow runs on main now. "
        "Once it has passed, deploy with `gh workflow run deploy.yml --ref main` (Actions, Deploy, Run workflow, from `main`).",
    ]


def test_a_check_only_run_s_summary_says_main_did_not_move(tmp_path):
    assert summary(tmp_path, SHA.upper(), check_only="true", move="skipped", main_now="") == [
        "### Checked only",
        f"Checked only: {SHA} may be promoted, and the App's token was minted; main did not move.",
    ]


def test_a_check_only_run_whose_token_failed_is_a_refusal(tmp_path):
    assert summary(tmp_path, check_only="true", token="failure", move="skipped", main_now="") == [
        "### Promote refused",
        "main did not move. The failed step's log says why.",
    ]


@pytest.mark.parametrize("token", ["skipped", "failure"])
def test_a_refusal_s_summary_says_main_did_not_move_and_never_repeats_the_input(tmp_path, token):
    lines = summary(tmp_path, commit="main`<b>not a sha</b>", token=token, move="skipped", main_now="")

    assert lines == ["### Promote refused", "main did not move. The failed step's log says why."]


@pytest.mark.parametrize("move", ["failure", "cancelled"])
def test_a_failed_move_s_summary_names_what_main_was_read_back_as(tmp_path, move):
    assert summary(tmp_path, move=move, main_now=OLD) == [
        "### Promote failed while moving main",
        f"main is at `{OLD}`, read back after the move. The failed step's log says why.",
    ]


def test_a_failed_move_whose_read_back_failed_says_how_to_look(tmp_path):
    assert summary(tmp_path, move="failure", main_now="") == [
        "### Promote failed while moving main",
        f"main could not be read back after the move, so it may be at `{SHA}` or where it was. "
        "Look with `gh api repos/owner/repo/git/ref/heads/main --jq .object.sha`.",
    ]
