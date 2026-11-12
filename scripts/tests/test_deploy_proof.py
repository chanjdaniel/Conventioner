"""The Deploy workflow's proof (T254), against a stub server, the real curl and a fake npx.

The workflow cannot run off production, so these are its dry run: each test runs the script's
command line as the workflow does and reads what the workflow reads, its exit code and its lines.
The fake npx stands where the pinned Vercel CLI's `vercel curl` stands: it records its arguments,
turns the staged `*.vercel.app` address into the stub's, and runs the real curl the way the CLI
does, `curl --url <address> --header <bypass> <the flags after -->`.
"""
import json
import os
import re
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "deploy_proof.py"

SHA = "3f2c9d1e8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e"
SHORT = SHA[:12]
OLD = "0a1b2c3d4e5f60718293a4b5c6d7e8f901234567"
TOKEN = "vercel-token-not-for-logs"
GITHUB_TOKEN = "github-token-not-for-logs"
BYPASS = "bypass-secret-not-for-logs"
STAGED = "https://conventioner-api-abc123-team.vercel.app"
STAGED_HOST = "conventioner-api-abc123-team.vercel.app"
RUNS = "/repos/owner/repo/actions/workflows/test.yml/runs"

DROP = "drop"
FAST = ["--timeout", "0.4", "--interval", "0.02"]

BACKEND_HEADERS = {"X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer"}
FRONTEND_HEADERS = {
    "Content-Security-Policy": "default-src 'self'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Strict-Transport-Security": "max-age=63072000",
}
APP = '<!doctype html><html><body><div id="app"></div></body></html>'

FAKE_NPX = """#!{python}
import json, os, re, subprocess, sys
args = sys.argv[1:]
with open(os.environ["FAKE_NPX_LOG"], "a") as log:
    log.write(json.dumps(args) + "\\n")
# What a CLI may print: its banner, the token it was given, the command it runs.
print("Vercel CLI 64.5.0", os.environ.get("VERCEL_TOKEN", ""), file=sys.stderr)
print("Executing: curl --header 'x-vercel-protection-bypass: {bypass}'", " ".join(args), file=sys.stderr)
if os.environ.get("FAKE_NPX_EXIT"):
    print("Error: could not reach the deployment", " ".join(args))
    sys.exit(int(os.environ["FAKE_NPX_EXIT"]))
url = args[args.index("curl") + 1]
address = re.sub(r"^https://[a-z0-9-]+[.]vercel[.]app", os.environ["FAKE_STUB_ORIGIN"], url)
flags = args[args.index("--") + 1:]
sys.exit(subprocess.call(
    ["curl", "--url", address, "--header", "x-vercel-protection-bypass: {bypass}", *flags],
    stdin=subprocess.DEVNULL,
))
"""


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
                    answer = (404, {}, "not found")
                else:
                    answer = answers.pop(0) if len(answers) > 1 else answers[0]
                if answer == DROP:
                    self.close_connection = True
                    return
                status, headers, body = answer
                data = body.encode() if isinstance(body, str) else body
                self.send_response(status)
                for name, value in headers.items():
                    self.send_header(name, value)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.origin = f"http://127.0.0.1:{self.server.server_port}"
        self.host = f"127.0.0.1:{self.server.server_port}"
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
def npx_log(tmp_path):
    return tmp_path / "npx.log"


@pytest.fixture
def env(tmp_path, stub, npx_log):
    """The workflow's environment for the script, with the fake npx first on PATH."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    npx = bin_dir / "npx"
    npx.write_text(FAKE_NPX.format(python=sys.executable, bypass=BYPASS))
    npx.chmod(0o755)
    return {
        "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
        "HOME": str(tmp_path),
        "FAKE_NPX_LOG": str(npx_log),
        "FAKE_STUB_ORIGIN": stub.origin,
        "VERCEL_CLI": "vercel@64.5.0",
        "VERCEL_TOKEN": TOKEN,
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


def errors(output):
    return [line for line in output.splitlines() if line.startswith("::error::")]


def never_leaks(output):
    for secret in (TOKEN, GITHUB_TOKEN, BYPASS, "npx", "--token", "--max-time"):
        assert secret not in output


#: What a deployed back end with its hatch off says of itself on /healthz.
DEPLOYED = {"deployed": True, "localDev": False}


def healthz(commit=SHA, status=200, state="ok", headers=BACKEND_HEADERS, seen=DEPLOYED):
    body = {"commit": commit, "status": state, **seen}
    return (status, {"Content-Type": "application/json", **headers}, json.dumps(body))


def version(commit=SHA):
    return (200, {"Content-Type": "application/json"}, json.dumps({"commit": commit}))


def markets(headers=FRONTEND_HEADERS, body=APP):
    return (200, {"Content-Type": "text/html", **headers}, body)


# green


def run_of(number, status="completed", conclusion="success", head_sha=SHA):
    return {
        "run_number": number,
        "status": status,
        "conclusion": conclusion,
        "head_sha": head_sha,
        "event": "push",
        "head_branch": "main",
        "html_url": f"https://github.com/owner/repo/actions/runs/{9000 + number}",
    }


def runs(*items):
    return (200, {"Content-Type": "application/json"}, json.dumps({"total_count": len(items), "workflow_runs": list(items)}))


def green(env):
    return run(env, "green", "--commit", SHA)


def test_green_passes_on_a_successful_newest_run(stub, env):
    stub.serve(RUNS, runs(run_of(41)))

    code, output = green(env)

    assert code == 0
    assert f"Test passed on main at {SHORT}: https://github.com/owner/repo/actions/runs/9041" in output
    assert errors(output) == []


def test_green_refuses_a_run_still_going(stub, env):
    stub.serve(RUNS, runs(run_of(41, status="in_progress", conclusion=None)))

    code, output = green(env)

    assert code == 1
    assert errors(output) == [
        f"::error::Test is still running on main at {SHORT} (https://github.com/owner/repo/actions/runs/9041)."
        " Run Deploy again once it has passed."
    ]


def test_green_refuses_a_failed_run(stub, env):
    stub.serve(RUNS, runs(run_of(41, conclusion="failure")))

    code, output = green(env)

    assert code == 1
    assert errors(output) == [
        f"::error::Test failure on main at {SHORT} (https://github.com/owner/repo/actions/runs/9041)."
        " Deploy only a commit whose Test run has passed."
    ]


def test_green_refuses_a_commit_with_no_run(stub, env):
    stub.serve(RUNS, runs())

    code, output = green(env)

    assert code == 1
    assert errors(output) == [
        f"::error::No Test run on main at {SHORT}. Deploy only a commit on main whose Test run has passed."
    ]


def test_green_counts_no_run_of_another_commit(stub, env):
    stub.serve(RUNS, runs(run_of(41, head_sha=OLD)))

    code, output = green(env)

    assert code == 1
    assert errors(output)[0].startswith(f"::error::No Test run on main at {SHORT}.")


@pytest.mark.parametrize(
    ("older", "newer", "passes"),
    [("success", "failure", False), ("failure", "success", True)],
)
@pytest.mark.parametrize("listed_newest_first", [True, False])
def test_the_newest_run_decides(stub, env, older, newer, passes, listed_newest_first):
    pair = [run_of(41, conclusion=older), run_of(42, conclusion=newer)]
    stub.serve(RUNS, runs(*(reversed(pair) if listed_newest_first else pair)))

    code, output = green(env)

    assert code == (0 if passes else 1)
    assert "actions/runs/9042" in output


def test_green_fails_closed_on_an_api_error(stub, env):
    stub.serve(RUNS, (500, {}, "upstream broke"))

    code, output = green(env)

    assert code == 1
    assert errors(output) == [
        f"::error::Could not read the Test runs for {SHORT} from GitHub (500), so nothing was deployed."
    ]
    assert stub.count(RUNS) == 1


def test_green_fails_closed_when_github_does_not_answer(stub, env):
    stub.serve(RUNS, DROP)

    code, output = green(env)

    assert code == 1
    [error] = errors(output)
    assert error.startswith(f"::error::Could not read the Test runs for {SHORT} from GitHub (")
    assert error.endswith("), so nothing was deployed.")
    assert "(500)" not in error


def test_green_asks_for_this_commit_on_a_push_to_main_with_the_token(stub, env):
    stub.serve(RUNS, runs(run_of(41)))

    code, output = green(env)

    [(path, query, headers)] = stub.requests
    assert code == 0
    assert path == RUNS
    assert query == {"head_sha": [SHA], "event": ["push"], "branch": ["main"], "per_page": ["100"]}
    assert headers["authorization"] == f"Bearer {GITHUB_TOKEN}"
    assert headers["accept"] == "application/vnd.github+json"
    assert headers["x-github-api-version"] == "2022-11-28"
    never_leaks(output)


@pytest.mark.parametrize("missing", ["GITHUB_TOKEN", "GITHUB_REPOSITORY"])
def test_green_needs_its_environment(stub, env, missing):
    del env[missing]

    code, output = green(env)

    assert code == 2
    assert missing in output
    assert stub.requests == []


# prove --own, the back end


def prove_own(env, project="backend", *extra):
    return run(env, "prove", "--project", project, "--own", "--url", STAGED, "--commit", SHA, *FAST, *extra)


def test_a_staged_back_end_of_this_commit_passes(stub, env):
    stub.serve("/healthz", healthz())

    code, output = prove_own(env)

    assert code == 0
    assert f"{STAGED_HOST} serves {SHORT} and its checks passed" in output
    assert stub.count("/healthz") == 1
    never_leaks(output)


@pytest.mark.parametrize(("reported", "shown"), [(OLD, OLD), (None, "null")])
def test_a_staged_back_end_of_another_commit_is_refused_at_once(stub, env, reported, shown):
    stub.serve("/healthz", healthz(commit=reported))

    code, output = prove_own(env)

    assert code == 1
    assert errors(output) == [
        f"::error::The staged back end at {STAGED} reports commit {shown}, not {SHORT}: it is not this build."
    ]
    assert stub.count("/healthz") == 1


def test_a_staged_back_end_without_a_commit_is_refused_at_once(stub, env):
    stub.serve("/healthz", (200, {"Content-Type": "application/json"}, '{"status": "ok"}'))

    code, output = prove_own(env)

    assert code == 1
    assert errors(output) == [
        f'::error::The staged back end at {STAGED} does not report its commit (200: {{"status": "ok"}}).'
    ]
    assert stub.count("/healthz") == 1


def test_a_401_is_refused_at_once(stub, env):
    stub.serve("/healthz", (401, {"Content-Type": "text/html"}, "Authentication Required"))

    code, output = prove_own(env)

    assert code == 1
    assert errors(output) == [f"::error::The staged back end at {STAGED} answered 401 (Authentication Required)."]
    assert stub.count("/healthz") == 1


def test_a_long_body_is_cut_to_200_characters_on_one_line(stub, env):
    stub.serve("/healthz", (403, {}, "line one\nline two\n" + "x" * 500))

    code, output = prove_own(env)

    [error] = errors(output)
    assert code == 1
    assert "line one line two " in error
    excerpt = error.split(" answered 403 (", 1)[1].removesuffix(").")
    assert len(excerpt) == 200


def test_a_cold_start_is_waited_for(stub, env):
    stub.serve(
        "/healthz",
        DROP,
        (503, {}, "starting"),
        healthz(status=503, state="unavailable"),
        healthz(state="unavailable"),
        healthz(),
    )

    code, output = prove_own(env, "backend", "--timeout", "5")

    assert code == 0
    assert stub.count("/healthz") == 5
    assert f"{STAGED_HOST} serves {SHORT} and its checks passed" in output


def test_a_staged_back_end_that_never_answers_times_out(stub, env):
    stub.serve("/healthz", DROP)

    code, output = prove_own(env)

    assert code == 1
    assert errors(output) == [
        f"::error::The staged back end at {STAGED} did not serve within 0.4s; last answer: no answer."
    ]
    assert stub.count("/healthz") > 1


def test_a_staged_back_end_that_keeps_failing_names_its_last_answer(stub, env):
    stub.serve("/healthz", healthz(status=503, state="unavailable"))

    code, output = prove_own(env)

    assert code == 1
    assert errors(output) == [
        f"::error::The staged back end at {STAGED} did not serve within 0.4s;"
        f' last answer: 503: {{"commit": "{SHA}", "status": "unavailable", "deployed": true, "localDev": false}}.'
    ]


@pytest.mark.parametrize("missing", ["X-Content-Type-Options", "Referrer-Policy"])
def test_a_staged_back_end_missing_a_header_is_refused_by_name(stub, env, missing):
    headers = {name: value for name, value in BACKEND_HEADERS.items() if name != missing}
    stub.serve("/healthz", healthz(headers=headers))

    code, output = prove_own(env)

    assert code == 1
    assert errors(output) == [f"::error::{STAGED_HOST} sends no {missing.lower()}"]


HATCH_ON = "runs with ALLOW_INSECURE_LOCAL_DEV on (/healthz says localDev is {value})."
NOT_DEPLOYED = (
    "does not see that it is deployed (/healthz says deployed is {value}), so its refusal of "
    "local-development switches is not armed. Tick \"Enable access to System Environment "
    "Variables\" in the back-end project's Environment Variables settings on Vercel, then deploy again."
)


@pytest.mark.parametrize(("seen", "said"), [
    ({"deployed": True, "localDev": True}, [HATCH_ON.format(value="true")]),
    ({"deployed": True, "localDev": "false"}, [HATCH_ON.format(value='"false"')]),
    ({"deployed": True, "localDev": None}, [HATCH_ON.format(value="null")]),
    ({"deployed": True, "localDev": 0}, [HATCH_ON.format(value="0")]),
    ({"deployed": True}, [HATCH_ON.format(value="absent")]),
    ({"deployed": False, "localDev": False}, [NOT_DEPLOYED.format(value="false")]),
    ({"deployed": 1, "localDev": False}, [NOT_DEPLOYED.format(value="1")]),
    ({"localDev": False}, [NOT_DEPLOYED.format(value="absent")]),
    ({}, [HATCH_ON.format(value="absent"), NOT_DEPLOYED.format(value="absent")]),
    ({"deployed": False, "localDev": True}, [HATCH_ON.format(value="true"), NOT_DEPLOYED.format(value="false")]),
])
def test_a_staged_back_end_not_deployed_with_its_hatch_off_is_refused(stub, env, seen, said):
    """The boot refuses local switches only where it sees a platform variable, so the proof reads
    both: the hatch must be off, and the back end must see that it is deployed."""
    stub.serve("/healthz", healthz(seen=seen))

    code, output = prove_own(env)

    assert code == 1
    assert errors(output) == [f"::error::{STAGED_HOST} {sentence}" for sentence in said]
    assert stub.count("/healthz") == 1
    never_leaks(output)


@pytest.mark.parametrize(
    "address",
    ["https://api.conventioner.io", "http://abc.vercel.app", "https://abc.vercel.app/", "https://a.b.vercel.app"],
)
def test_own_takes_only_a_deployments_own_address(stub, env, npx_log, address):
    code, output = run(env, "prove", "--project", "backend", "--own", "--url", address, "--commit", SHA)

    assert code == 2
    assert "--own" in output
    assert not npx_log.exists()


# prove --own, the front end


def test_a_staged_front_end_of_this_commit_passes(stub, env):
    stub.serve("/version.json", version())
    stub.serve("/markets", markets())

    code, output = prove_own(env, "frontend")

    assert code == 0
    assert f"{STAGED_HOST} serves {SHORT} and its checks passed" in output
    assert (stub.count("/version.json"), stub.count("/markets")) == (1, 1)


def test_a_report_only_policy_does_not_stand_for_the_enforced_one(stub, env):
    headers = {name: value for name, value in FRONTEND_HEADERS.items() if name != "Content-Security-Policy"}
    stub.serve("/version.json", version())
    stub.serve("/markets", markets(headers={**headers, "Content-Security-Policy-Report-Only": "default-src 'self'"}))

    code, output = prove_own(env, "frontend")

    assert code == 1
    assert errors(output) == [f"::error::{STAGED_HOST} sends no content-security-policy"]


def test_a_staged_front_end_with_no_version_file_is_refused_at_once(stub, env):
    stub.serve("/version.json", (200, {"Content-Type": "text/html"}, APP))

    code, output = prove_own(env, "frontend")

    assert code == 1
    assert errors(output) == [f"::error::The staged front end at {STAGED} does not report its commit (200: {APP})."]
    assert stub.count("/version.json") == 1
    assert stub.count("/markets") == 0


@pytest.mark.parametrize("missing", list(FRONTEND_HEADERS))
def test_a_staged_front_end_missing_a_header_is_refused_by_name(stub, env, missing):
    headers = {name: value for name, value in FRONTEND_HEADERS.items() if name != missing}
    stub.serve("/version.json", version())
    stub.serve("/markets", markets(headers=headers))

    code, output = prove_own(env, "frontend")

    assert code == 1
    assert errors(output) == [f"::error::{STAGED_HOST} sends no {missing.lower()}"]


@pytest.mark.parametrize(
    ("answer", "status"),
    [(markets(body="<!doctype html><title>404</title>"), 200), ((404, FRONTEND_HEADERS, "missing"), 404)],
)
def test_a_staged_front_end_without_the_deep_link_is_refused(stub, env, answer, status):
    stub.serve("/version.json", version())
    stub.serve("/markets", answer)

    code, output = prove_own(env, "frontend")

    assert code == 1
    assert errors(output) == [f"::error::{STAGED_HOST} serves no app at /markets ({status})"]


# prove --own, through the CLI


def test_own_reads_through_vercel_curl_with_every_curl_flag_after_the_separator(stub, env, npx_log):
    stub.serve("/healthz", healthz())

    code, output = prove_own(env)

    [args] = [json.loads(line) for line in npx_log.read_text().splitlines()]
    separator = args.index("--")
    before, after = args[:separator], args[separator + 1:]
    assert code == 0
    assert before == ["--yes", "vercel@64.5.0", "curl", f"{STAGED}/healthz", "--yes", "--token", TOKEN]
    assert after[:3] == ["-sS", "--max-time", "20"]
    assert "-D" in after and "-o" in after
    assert not {"-v", "-L", "--verbose", "--location"} & set(args)
    [(_, _, headers)] = stub.requests
    assert headers["x-vercel-protection-bypass"] == BYPASS
    never_leaks(output)


def test_a_failing_cli_is_no_answer_and_shows_nothing_it_was_given(stub, env, npx_log):
    env["FAKE_NPX_EXIT"] = "3"
    stub.serve("/healthz", healthz())

    code, output = prove_own(env)

    assert code == 1
    assert "vercel curl exited 3" in output
    assert errors(output) == [
        f"::error::The staged back end at {STAGED} did not serve within 0.4s; last answer: no answer."
    ]
    assert len(npx_log.read_text().splitlines()) > 1
    never_leaks(output)
    assert "could not reach" not in output


@pytest.mark.parametrize("missing", ["VERCEL_TOKEN", "VERCEL_CLI"])
def test_own_needs_the_cli_and_its_token(stub, env, npx_log, missing):
    del env[missing]

    code, output = prove_own(env)

    assert code == 2
    assert missing in output
    assert not npx_log.exists()


# prove --domain


def prove_domain(stub, env, project="backend", *extra):
    return run(env, "prove", "--project", project, "--domain", "--url", stub.origin, "--commit", SHA, *FAST, *extra)


def test_a_domain_is_waited_for_until_it_serves_this_commit(stub, env, npx_log):
    stub.serve("/healthz", healthz(commit=OLD), healthz(commit=OLD), healthz(commit=OLD), healthz())

    code, output = prove_domain(stub, env, "backend", "--timeout", "5")

    waiting = [line for line in output.splitlines() if line.endswith(f"waiting for {SHORT}")]
    assert code == 0
    assert stub.count("/healthz") == 4
    assert waiting == [f"{stub.host} serves {OLD}, waiting for {SHORT}"] * 3
    assert f"{stub.host} serves {SHORT} and its checks passed" in output
    assert not npx_log.exists()


def test_a_domain_whose_back_end_has_its_hatch_on_is_refused(stub, env):
    stub.serve("/healthz", healthz(seen={"deployed": True, "localDev": True}))

    code, output = prove_domain(stub, env)

    assert code == 1
    assert errors(output) == [f"::error::{stub.host} {HATCH_ON.format(value='true')}"]


def test_a_domain_whose_back_end_does_not_see_it_is_deployed_is_refused(stub, env):
    stub.serve("/healthz", healthz(seen={"deployed": False, "localDev": False}))

    code, output = prove_domain(stub, env)

    assert code == 1
    assert errors(output) == [f"::error::{stub.host} {NOT_DEPLOYED.format(value='false')}"]


def test_a_domain_that_keeps_the_old_commit_times_out_naming_it(stub, env, npx_log):
    stub.serve("/healthz", healthz(commit=OLD))

    code, output = prove_domain(stub, env)

    assert code == 1
    assert errors(output) == [
        f"::error::{stub.host} still served commit {OLD} after 0.4s, not {SHORT}; last answer: 200."
    ]
    assert not npx_log.exists()


def test_a_domain_that_never_answers_times_out_with_no_commit_seen(stub, env):
    stub.serve("/healthz", DROP)

    code, output = prove_domain(stub, env)

    assert code == 1
    assert errors(output) == [
        f"::error::{stub.host} still served commit none after 0.4s, not {SHORT}; last answer: no answer."
    ]
    assert f"{stub.host} serves no answer, waiting for {SHORT}" in output


def test_a_domain_names_the_last_commit_it_saw(stub, env):
    stub.serve("/version.json", version(commit=OLD), (502, {}, "bad gateway"))

    code, output = prove_domain(stub, env, "frontend")

    assert code == 1
    assert errors(output) == [
        f"::error::{stub.host} still served commit {OLD} after 0.4s, not {SHORT}; last answer: 502."
    ]
    assert f"{stub.host} serves 502, waiting for {SHORT}" in output


def test_a_domain_still_serving_the_app_shell_for_the_version_file_is_waited_for(stub, env):
    stub.serve("/version.json", (200, {"Content-Type": "text/html"}, APP), version(commit=None), version())
    stub.serve("/markets", markets())

    code, output = prove_domain(stub, env, "frontend", "--timeout", "5")

    assert code == 0
    assert f"{stub.host} serves 200, waiting for {SHORT}" in output
    assert f"{stub.host} serves null, waiting for {SHORT}" in output


def test_a_domains_checks_run_once_after_the_commit_matches(stub, env):
    stub.serve("/version.json", version(commit=OLD), version())
    stub.serve("/markets", markets())

    code, output = prove_domain(stub, env, "frontend", "--timeout", "5")

    assert code == 0
    assert (stub.count("/version.json"), stub.count("/markets")) == (2, 1)


def test_a_domain_missing_a_header_is_refused_by_name(stub, env):
    stub.serve("/version.json", version())
    stub.serve("/markets", markets(headers={k: v for k, v in FRONTEND_HEADERS.items() if k != "X-Frame-Options"}))

    code, output = prove_domain(stub, env, "frontend")

    assert code == 1
    assert errors(output) == [f"::error::{stub.host} sends no x-frame-options"]
    assert stub.count("/markets") == 1


def test_the_whole_dry_run_takes_fractions_of_a_second_per_wait(stub, env):
    stub.serve("/healthz", healthz(commit=OLD))
    started = time.monotonic()

    code, _ = run(
        env, "prove", "--project", "backend", "--domain", "--url", stub.origin, "--commit", SHA,
        "--timeout", "0.25", "--interval", "0.05",
    )

    assert code == 1
    assert time.monotonic() - started < 5


# The Deploy workflow, read as text: the job that runs this file has no YAML library.

WORKFLOW = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "deploy.yml"

ORDER = [
    "actions/checkout",
    "Refuse to run half-configured",
    "Test passed on main at this commit",
    "actions/setup-node",
    "Stage the back end",
    "The staged back end is this commit",
    "Stage the front end",
    "The staged front end is this commit",
    "Promote the back end",
    "api.conventioner.io serves this commit",
    "Promote the front end",
    "conventioner.io serves this commit",
    "Say what production serves",
]

PROJECT_IDS = {
    "${{ vars.VERCEL_BACKEND_PROJECT_ID }}": "backend",
    "${{ vars.VERCEL_FRONTEND_PROJECT_ID }}": "frontend",
}
DOMAINS = {"backend": "https://api.conventioner.io", "frontend": "https://conventioner.io"}


def mapping(lines, indent):
    """The `key: value` pairs written at exactly `indent` spaces."""
    pairs = {}
    for line in lines:
        if line.startswith(" " * indent) and not line[indent:].startswith((" ", "#")) and ":" in line:
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


def workflow():
    lines = WORKFLOW.read_text().splitlines()
    top = {line.split(":")[0]: i for i, line in enumerate(lines) if line and not line[0].isspace() and ":" in line}
    starts = [i for i, line in enumerate(lines) if line.startswith("      - ")]
    steps = []
    for n, start in enumerate(starts):
        end = starts[n + 1] if n + 1 < len(starts) else len(lines)
        body = ["        " + lines[start][8:]] + lines[start + 1:end]
        keys = mapping(body, 8)
        step = {"name": keys.get("name"), "id": keys.get("id"), "if": keys.get("if"), "env": {}, "run": ""}
        if "uses" in keys:
            step["title"] = keys["uses"].split("@")[0]
        else:
            step["title"] = step["name"]
        for i, line in enumerate(body):
            if line == "        env:":
                step["env"] = mapping(block(body, i, 8), 10)
            if line.startswith("        run:"):
                inline = line[len("        run:"):].strip()
                if inline == "|":
                    step["run"] = "\n".join(l[10:] for l in block(body, i, 8)).strip() + "\n"
                else:
                    step["run"] = inline + "\n"
        steps.append(step)
    return {
        "permissions": mapping(block(lines, top["permissions"], 0), 2),
        "env": mapping(block(lines, top["env"], 0), 2),
        "steps": steps,
    }


def step_named(name):
    return next(step for step in workflow()["steps"] if step["name"] == name)


def where(predicate):
    return [i for i, step in enumerate(workflow()["steps"]) if predicate(step)]


def is_stage(step):
    return '"$VERCEL_CLI" deploy' in step["run"]


def is_promote(step):
    return '"$VERCEL_CLI" promote' in step["run"]


def is_proof(step, mode):
    return "deploy_proof.py prove" in step["run"] and f"--{mode}" in step["run"]


def project_of(step):
    if "deploy_proof.py" in step["run"]:
        return step["run"].split("--project ")[1].split()[0]
    return PROJECT_IDS[step["env"]["VERCEL_PROJECT_ID"]]


def test_the_deploy_runs_its_steps_in_order():
    assert [step["title"] for step in workflow()["steps"]] == ORDER


def test_the_steps_others_read_have_their_ids():
    ids = {step["name"]: step["id"] for step in workflow()["steps"] if step["id"]}

    assert ids == {
        "Stage the back end": "stage-backend",
        "Stage the front end": "stage-frontend",
        "Promote the back end": "promote-backend",
        "Promote the front end": "promote-frontend",
    }


def test_the_workflow_may_read_the_code_and_the_test_runs_and_nothing_more():
    assert workflow()["permissions"] == {"contents": "read", "actions": "read"}


def test_the_test_run_is_checked_before_anything_is_built():
    step = step_named("Test passed on main at this commit")
    steps = workflow()["steps"]

    assert step["run"] == 'python3 scripts/deploy_proof.py green --commit "$GITHUB_SHA"\n'
    assert step["env"] == {"GITHUB_TOKEN": "${{ github.token }}"}
    assert steps.index(step) < min(where(is_stage))


# A step runs the Vercel CLI when a command word of its `run:` is `npx` or `vercel`. Which of its
# calls deploy is read from what the fake CLI received, never from the step's text.
RUNS_THE_CLI = re.compile(r"(?:^|[\s;&|(])(?:npx|vercel)\s", re.MULTILINE)
# The Vercel CLI's global options that take a value, so the value is not read as its command.
VALUE_OPTIONS = {"--token", "-t", "--scope", "-S", "--team", "-T", "--cwd", "--local-config", "-A", "--global-config", "-Q"}
# The commands the workflow runs that do not deploy. Any other command, or none (the CLI's default
# command deploys), counts as a deploy, so a spelling nobody foresaw is held to the rule.
NOT_A_DEPLOY = {"promote", "curl", "inspect"}


def cli_calls(log):
    """Each call the fake CLI received, as the Vercel CLI's own arguments."""
    calls = []
    for line in (log.read_text() if log.exists() else "").splitlines():
        program, *args = line.split("\x1f")[:-1]
        if os.path.basename(program) == "npx":
            args = args[next(i for i, a in enumerate(args) if not a.startswith("-")) + 1:]
        calls.append(args)
    return calls


def command_of(args):
    """The Vercel CLI command a call runs, or None for its default command."""
    rest = iter(args)
    for arg in rest:
        if arg == "--":
            return None
        if arg in VALUE_OPTIONS:
            next(rest, None)
        elif not arg.startswith("-"):
            return arg
    return None


def deploy_problems(tmp_path, steps):
    """Run every step that runs the Vercel CLI under the fakes, and say what breaks the rule.

    Returns the names of the steps that deploy, and each problem: a step whose call never reached
    a fake, or a deploy without `--prod` and `--skip-domain`.
    """
    deploying, problems = [], []
    for n, step in enumerate(steps):
        if not RUNS_THE_CLI.search(step["run"]):
            continue
        here = tmp_path / str(n)
        here.mkdir()
        run_step(here, step, FAKE_STDOUT=STAGED, STAGED_URL=STAGED)
        calls = cli_calls(here / "calls.log")
        if not calls:
            problems.append(f"{step['title']}: its call never reached the fake CLI")
        deploys = [args for args in calls if command_of(args) not in NOT_A_DEPLOY]
        if deploys:
            deploying.append(step["name"])
        for args in deploys:
            if "--prod" not in args or "--skip-domain" not in args:
                problems.append(f"{step['title']}: deploys without --prod --skip-domain")
    return deploying, problems


def test_every_deploy_is_a_production_deployment_that_takes_no_domain(tmp_path):
    steps = workflow()["steps"]

    deploying, problems = deploy_problems(tmp_path, steps)

    assert problems == []
    assert deploying == ["Stage the back end", "Stage the front end"]
    assert not {"Deploy the back end", "Deploy the front end"} & {step["name"] for step in steps}


@pytest.mark.parametrize(
    "run",
    [
        # The CLI's default command deploys with no `deploy` word.
        'npx --yes "$VERCEL_CLI" --yes --token "$VERCEL_TOKEN"',
        'npx --yes "${VERCEL_CLI}" deploy --yes',
        'npx --yes $VERCEL_CLI deploy --yes',
        'npx --yes "$VERCEL_CLI" --token "$VERCEL_TOKEN" deploy --prod --yes',
        "vercel deploy --prod --yes",
        'url=$(npx --yes vercel@64.5.0 --prod)',
    ],
)
def test_a_deploy_that_would_take_the_domain_is_caught_however_it_is_spelled(tmp_path, run):
    sneaked = {"name": "Sneak", "title": "Sneak", "id": None, "if": None, "env": {}, "run": run + "\n"}

    deploying, problems = deploy_problems(tmp_path, workflow()["steps"] + [sneaked])

    assert "Sneak" in deploying
    assert problems == ["Sneak: deploys without --prod --skip-domain"]


def test_a_step_whose_cli_call_never_reaches_the_fake_is_a_problem(tmp_path):
    sneaked = {"name": "Sneak", "title": "Sneak", "id": None, "if": None, "env": {}, "run": "true || npx --yes x\n"}

    _, problems = deploy_problems(tmp_path, [sneaked])

    assert problems == ["Sneak: its call never reached the fake CLI"]


def test_nothing_is_promoted_before_both_builds_have_proven_themselves():
    steps = workflow()["steps"]
    at = {}
    for kind, test in (
        ("stage", is_stage),
        ("own", lambda s: is_proof(s, "own")),
        ("promote", is_promote),
        ("domain", lambda s: is_proof(s, "domain")),
    ):
        for i in where(test):
            at[(kind, project_of(steps[i]))] = i

    assert len(at) == 8
    assert max(at[("own", p)] for p in DOMAINS) < min(at[("promote", p)] for p in DOMAINS)
    for p in DOMAINS:
        assert at[("stage", p)] < at[("own", p)] < at[("promote", p)] < at[("domain", p)]
    assert at[("domain", "backend")] < at[("promote", "frontend")]


def test_each_proof_and_promotion_reads_its_own_projects_staged_address():
    steps = [step for step in workflow()["steps"] if is_proof(step, "own") or is_promote(step)]

    assert len(steps) == 4
    for step in steps:
        assert step["env"]["STAGED_URL"] == f"${{{{ steps.stage-{project_of(step)}.outputs.url }}}}"
        assert '"$STAGED_URL"' in step["run"]
        assert PROJECT_IDS[step["env"]["VERCEL_PROJECT_ID"]] == project_of(step)


def test_each_domain_is_waited_for_on_its_own_address():
    steps = [step for step in workflow()["steps"] if is_proof(step, "domain")]

    assert sorted(project_of(step) for step in steps) == ["backend", "frontend"]
    for step in steps:
        assert f"--url {DOMAINS[project_of(step)]} " in step["run"]
        assert '--commit "$GITHUB_SHA"' in step["run"]


def test_the_token_is_held_only_by_the_steps_that_run_the_vercel_cli():
    flow = workflow()

    assert "VERCEL_TOKEN" not in flow["env"]
    for step in flow["steps"]:
        runs_the_cli = "$VERCEL_CLI" in step["run"] or is_proof(step, "own")
        assert ("VERCEL_TOKEN" in step["env"]) == runs_the_cli, step["title"]
        if runs_the_cli:
            assert step["env"]["VERCEL_TOKEN"] == "${{ secrets.VERCEL_TOKEN }}"
    assert "VERCEL_TOKEN" not in step_named("Test passed on main at this commit")["env"]
    for i in where(lambda s: is_proof(s, "domain")):
        assert "VERCEL_TOKEN" not in flow["steps"][i]["env"]


def test_no_run_script_holds_an_expression():
    for step in workflow()["steps"]:
        assert "${{" not in step["run"], step["title"]


# The workflow's own shell, run as the runner runs it (`bash -e`), with a fake npx and a fake vercel.

FAKE_DEPLOY = """#!/bin/sh
printf '%s\\n' "$@" > "$FAKE_NPX_LOG"
printf '%s\\037' "$0" "$@" >> "$FAKE_CALLS_LOG"
printf '\\n' >> "$FAKE_CALLS_LOG"
echo "Vercel CLI 64.5.0" >&2
echo "Building..." >&2
printf '%b' "$FAKE_STDOUT"
exit "${FAKE_EXIT:-0}"
"""


def run_step(tmp_path, step, **extra):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    for name in ("npx", "vercel"):
        fake = bin_dir / name
        fake.write_text(FAKE_DEPLOY)
        fake.chmod(0o755)
    script = tmp_path / "step.sh"
    script.write_text(step["run"])
    outputs = tmp_path / "outputs"
    outputs.write_text("")
    summary = tmp_path / "summary"
    summary.write_text("")
    env = {
        "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
        "HOME": str(tmp_path),
        "FAKE_NPX_LOG": str(tmp_path / "npx.log"),
        "FAKE_CALLS_LOG": str(tmp_path / "calls.log"),
        "VERCEL_CLI": "vercel@64.5.0",
        "VERCEL_TOKEN": TOKEN,
        "GITHUB_SHA": SHA,
        "GITHUB_OUTPUT": str(outputs),
        "GITHUB_STEP_SUMMARY": str(summary),
        **extra,
    }
    result = subprocess.run(["bash", "-e", str(script)], env=env, capture_output=True, text=True, timeout=30)
    return result.returncode, result.stdout + result.stderr, outputs.read_text(), summary.read_text()


@pytest.mark.parametrize(
    "name,stamp",
    [("Stage the back end", "--env"), ("Stage the front end", "--build-env")],
)
def test_a_stage_step_hands_on_the_address_vercel_printed(tmp_path, name, stamp):
    code, output, outputs, _ = run_step(tmp_path, step_named(name), FAKE_STDOUT=f"{STAGED}")

    assert code == 0
    assert outputs == f"url={STAGED}\n"
    assert errors(output) == []
    assert (tmp_path / "npx.log").read_text().split("\n")[:-1] == [
        "--yes", "vercel@64.5.0", "deploy", "--prod", "--skip-domain", "--yes", "--token", TOKEN,
        stamp, f"BUILD_COMMIT={SHA}",
    ]


@pytest.mark.parametrize(
    "stdout",
    [
        "",
        "\\n",
        f"{STAGED}\\nhttps://conventioner.io",
        "https://conventioner.io",
        f"{STAGED}/markets",
        "http://conventioner-api-abc123-team.vercel.app",
    ],
)
@pytest.mark.parametrize("name", ["Stage the back end", "Stage the front end"])
def test_a_stage_step_refuses_without_a_deployment_address(tmp_path, name, stdout):
    code, output, outputs, _ = run_step(tmp_path, step_named(name), FAKE_STDOUT=stdout)

    assert code == 1
    assert errors(output) == ["::error::vercel deploy printed no deployment address"]
    assert outputs == ""


def test_a_stage_step_takes_the_last_line_vercel_printed(tmp_path):
    code, _, outputs, _ = run_step(
        tmp_path, step_named("Stage the back end"), FAKE_STDOUT=f"something else\\n{STAGED}\\n"
    )

    assert code == 0
    assert outputs == f"url={STAGED}\n"


def test_a_failed_deploy_fails_its_stage_step(tmp_path):
    code, _, outputs, _ = run_step(tmp_path, step_named("Stage the back end"), FAKE_STDOUT=STAGED, FAKE_EXIT="1")

    assert code != 0
    assert outputs == ""


# Every summary ends with the two commands that say what each domain serves, then the runbook.
ENDING = [
    "Look at what each domain serves: `curl https://api.conventioner.io/healthz` and "
    "`curl https://conventioner.io/version.json`.",
    "See docs/RELEASING.md#when-a-deploy-refuses-or-times-out.",
]
NOTHING = [
    "### Production deploy refused",
    "Nothing was promoted: both domains still serve the build they served before this run. "
    "The failed step's log says why.",
    *ENDING,
]
BACKEND_PROMOTION_FAILED = [
    "### Production deploy failed while promoting the back end",
    "The promotion of the back end failed partway, so api.conventioner.io may serve this commit or "
    "the build before it. The front end was not promoted, so conventioner.io serves the build before "
    "this run. The failed step's log says why.",
    *ENDING,
]
HALFWAY = [
    "### Production deploy stopped halfway",
    "The back end was promoted and the front end was not, so conventioner.io serves the build before "
    "this run; the failed step's log says what api.conventioner.io served last. Fix the cause and run "
    "Deploy again, or roll the back end back (Vercel, Deployments, Instant Rollback).",
    *ENDING,
]
FRONTEND_PROMOTION_FAILED = [
    "### Production deploy failed while promoting the front end",
    "The back end was promoted and api.conventioner.io served this commit. The promotion of the "
    "front end failed partway, so conventioner.io may serve this commit or the build before it. "
    "The failed step's log says why.",
    *ENDING,
]
BOTH = [
    "### Production deploy failed after promotion",
    "Both projects were promoted, but a domain did not report this commit in time or failed a "
    "check. Read the failed step's log, then roll back each project if the build is wrong (Vercel, "
    "Deployments, Instant Rollback).",
    *ENDING,
]


def test_the_summary_runs_only_on_failure_and_reads_both_promotions():
    step = step_named("Say what production serves")

    assert step["if"] == "failure()"
    assert sorted(step["env"].values()) == [
        "${{ steps.promote-backend.outcome }}",
        "${{ steps.promote-frontend.outcome }}",
    ]


@pytest.mark.parametrize(
    "backend,frontend,text",
    [
        ("skipped", "skipped", NOTHING),
        # A promote step that failed may have moved its domain: Vercel can take the promotion and
        # the CLI still exit non-zero, its wait timed out.
        ("failure", "skipped", BACKEND_PROMOTION_FAILED),
        # The back end's domain proof failed after a good promote, so the front end was never tried.
        ("success", "skipped", HALFWAY),
        ("success", "failure", FRONTEND_PROMOTION_FAILED),
        ("success", "success", BOTH),
    ],
)
def test_the_summary_says_what_production_serves(tmp_path, backend, frontend, text):
    step = step_named("Say what production serves")
    outcomes = {"${{ steps.promote-backend.outcome }}": backend, "${{ steps.promote-frontend.outcome }}": frontend}
    env = {key: outcomes[value] for key, value in step["env"].items()}

    code, _, _, summary = run_step(tmp_path, step, **env)

    assert code == 0
    assert summary.splitlines() == text


def summary_for(tmp_path, backend, frontend):
    step = step_named("Say what production serves")
    names = {value: key for key, value in step["env"].items()}
    env = {
        names["${{ steps.promote-backend.outcome }}"]: backend,
        names["${{ steps.promote-frontend.outcome }}"]: frontend,
    }
    return run_step(tmp_path, step, **env)[3]


def test_a_failed_promotion_is_not_read_as_nothing_promoted(tmp_path):
    summary = summary_for(tmp_path, "failure", "skipped")

    assert "Nothing was promoted" not in summary
    assert "api.conventioner.io may serve this commit or the build before it" in summary


def test_a_failed_back_end_domain_proof_claims_nothing_of_what_the_api_serves(tmp_path):
    summary = summary_for(tmp_path, "success", "skipped")

    assert "api.conventioner.io serves" not in summary
    assert "api.conventioner.io served this commit" not in summary
