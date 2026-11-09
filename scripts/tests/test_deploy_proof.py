"""The Deploy workflow's proof (T254), against a stub server, the real curl and a fake npx.

The workflow cannot run off production, so these are its dry run: each test runs the script's
command line as the workflow does and reads what the workflow reads, its exit code and its lines.
The fake npx stands where the pinned Vercel CLI's `vercel curl` stands: it records its arguments,
turns the staged `*.vercel.app` address into the stub's, and runs the real curl the way the CLI
does, `curl --url <address> --header <bypass> <the flags after -->`.
"""
import json
import os
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


def healthz(commit=SHA, status=200, state="ok", headers=BACKEND_HEADERS):
    return (status, {"Content-Type": "application/json", **headers}, json.dumps({"commit": commit, "status": state}))


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
        f' last answer: 503: {{"commit": "{SHA}", "status": "unavailable"}}.'
    ]


@pytest.mark.parametrize("missing", ["X-Content-Type-Options", "Referrer-Policy"])
def test_a_staged_back_end_missing_a_header_is_refused_by_name(stub, env, missing):
    headers = {name: value for name, value in BACKEND_HEADERS.items() if name != missing}
    stub.serve("/healthz", healthz(headers=headers))

    code, output = prove_own(env)

    assert code == 1
    assert errors(output) == [f"::error::{STAGED_HOST} sends no {missing.lower()}"]


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


def test_a_report_only_policy_counts(stub, env):
    headers = {name: value for name, value in FRONTEND_HEADERS.items() if name != "Content-Security-Policy"}
    stub.serve("/version.json", version())
    stub.serve("/markets", markets(headers={**headers, "Content-Security-Policy-Report-Only": "default-src 'self'"}))

    code, output = prove_own(env, "frontend")

    assert code == 0


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
