#!/usr/bin/env python3
"""Every check the Deploy workflow makes before and after it gives a build the production domain (T254).

The workflow cannot be run off production, so its decisions live here, where
scripts/tests/test_deploy_proof.py runs them against stubs as its dry run. Two commands:

    green --commit <sha>
        Whether the Test workflow passed on a push to `main` at that commit. Every check `main`
        requires is a job of the Test workflow, and branch protection's own list needs an admin
        token to read, so a Test run that concluded `success` is the proof. The newest run by
        `run_number` decides; a re-run of failed jobs is the same run. It fails closed: an error
        from GitHub refuses, with no retry. Needs GITHUB_REPOSITORY and GITHUB_TOKEN;
        GITHUB_API_URL defaults to https://api.github.com.

    prove --project backend|frontend --url <address> --commit <sha> (--own | --domain)
        Whether one address serves this commit, read from `/healthz` (whose `status` must also be
        `ok`) or `/version.json`, then the project's checks, once: the back end's `localDev`
        (exactly `false`) and `deployed` (exactly `true`) and its security headers on that same
        answer, the front end's deep link `/markets` and the headers it sends. These lists are the
        only copy the workflow has.

        --own is a staged deployment's generated `https://<name>.vercel.app` address, which never
        changes what it serves, so another commit, no commit or a 4xx is refused at once, and only
        no answer, a 5xx or a back end still `unavailable` is retried (default 120s, every 10s).
        It reads through the pinned Vercel CLI's `vercel curl` (VERCEL_CLI and VERCEL_TOKEN),
        which adds the project's Protection Bypass for Automation header, so it works whether
        Deployment Protection is on or off.

        --domain is a production domain, which serves the old build until the edge moves, so any
        answer that is not this commit is waited for (default 300s, every 5s), with one line per
        wait. It runs the system curl, and holds no token.

Exit codes: 0 proven, 1 refused or timed out, 2 a usage error. Each refusal is one `::error::`
line. Nothing printed holds a token, a command line or the CLI's own output (which could hold the
bypass secret, which GitHub would not mask), or more than 200 characters of a response body; curl
never runs with -v or -L, which would print or follow the bypass header.
"""
import argparse
import http.client
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

OWN_ADDRESS = re.compile(r"^https://[a-z0-9-]+\.vercel\.app$")
EXCERPT = 200
CURL_FLAGS = ["-sS", "--max-time", "20"]
# Long enough for npx to fetch the pinned CLI on a fresh runner before curl's own 20 seconds.
CLI_TIMEOUT = 180


class NoCommit:
    """An answer that reports no commit at all, as distinct from one reporting `null`."""


NO_COMMIT = NoCommit()


@dataclass
class Answer:
    status: Optional[int] = None
    headers: Dict[str, str] = field(default_factory=dict)
    body: bytes = b""

    @property
    def said(self) -> str:
        return "no answer" if self.status is None else str(self.status)

    def excerpt(self) -> str:
        text = " ".join(self.body.decode("utf-8", errors="replace").split())
        return text[:EXCERPT]

    def described(self) -> str:
        """`<status>: <excerpt>`, or `no answer`."""
        return "no answer" if self.status is None else f"{self.status}: {self.excerpt()}"

    def json(self) -> Optional[dict]:
        if self.status != 200:
            return None
        try:
            data = json.loads(self.body)
        except ValueError:
            return None
        return data if isinstance(data, dict) and "commit" in data else None


@dataclass(frozen=True)
class Project:
    name: str
    path: str
    # Whether an answer reporting the commit says the build is up (the back end's `status`).
    serving: Callable[[dict], bool]
    # Each entry is a header and the names that may stand for it; the first is the one a refusal names.
    headers: Tuple[Tuple[str, ...], ...]
    # The path whose answer must hold the app, and whose headers are checked; None checks the commit's answer.
    page: Optional[str] = None
    # What the commit's answer must say of itself: each failure as a sentence after the host.
    says: Callable[[dict], List[str]] = lambda data: []


def said(data: dict, key: str) -> str:
    """A reported value as a refusal shows it: JSON, cut to the excerpt's length, or `absent`."""
    return " ".join(json.dumps(data[key]).split())[:EXCERPT] if key in data else "absent"


def deployed_with_the_hatch_off(data: dict) -> List[str]:
    """The back end's boot refuses local switches only where it sees a platform variable
    (back-end/utils/deployment.py), so both what it sees and its hatch are read."""
    failures = []
    if data.get("localDev", None) is not False:
        failures.append(f"runs with ALLOW_INSECURE_LOCAL_DEV on (/healthz says localDev is {said(data, 'localDev')}).")
    if data.get("deployed", None) is not True:
        failures.append(
            f"does not see that it is deployed (/healthz says deployed is {said(data, 'deployed')}), so its refusal of "
            'local-development switches is not armed. Tick "Enable access to System Environment Variables" in the '
            "back-end project's Environment Variables settings on Vercel, then deploy again."
        )
    return failures


PROJECTS = {
    # The headers back-end/utils/security_headers.py adds to every answer.
    "backend": Project(
        name="back end",
        path="/healthz",
        serving=lambda data: data.get("status") == "ok",
        headers=(("x-content-type-options",), ("referrer-policy",)),
        says=deployed_with_the_hatch_off,
    ),
    # The headers front-end/vercel.json declares; the policy may be report-only or enforcing.
    "frontend": Project(
        name="front end",
        path="/version.json",
        serving=lambda data: True,
        headers=(
            ("content-security-policy", "content-security-policy-report-only"),
            ("x-content-type-options",),
            ("referrer-policy",),
            ("x-frame-options",),
            ("strict-transport-security",),
        ),
        page="/markets",
    ),
}


def say(line: str) -> None:
    print(line, flush=True)


def refuse(sentence: str) -> int:
    say(f"::error::{sentence}")
    return 1


def short(sha: str) -> str:
    return sha[:12]


def shown(commit) -> str:
    """A reported commit as a line shows it: `null` for none, and never more than the excerpt's length."""
    if commit is None:
        return "null"
    text = commit if isinstance(commit, str) else json.dumps(commit)
    return " ".join(text.split())[:EXCERPT]


def read_answer(headers_file: Path, body_file: Path) -> Answer:
    """The last response curl wrote: it writes one header block per response, interim ones included."""
    try:
        text = headers_file.read_text("latin-1")
    except OSError:
        return Answer()
    status, headers = None, {}
    for line in text.splitlines():
        if line.startswith("HTTP/"):
            parts = line.split()
            status = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else None
            headers = {}
        elif ":" in line:
            name, value = line.split(":", 1)
            headers[name.strip().lower()] = value.strip()
    if status is None:
        return Answer()
    body = body_file.read_bytes() if body_file.exists() else b""
    return Answer(status, headers, body)


def fetch_plain(url: str) -> Answer:
    """GET through the system curl, for a production domain."""
    with tempfile.TemporaryDirectory() as scratch:
        headers_file, body_file = Path(scratch, "headers"), Path(scratch, "body")
        subprocess.run(
            ["curl", *CURL_FLAGS, "-D", str(headers_file), "-o", str(body_file), url],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return read_answer(headers_file, body_file)


def vercel_fetch(cli: str, token: str) -> Callable[[str], Answer]:
    """GET through `vercel curl`, which adds the deployment's Protection Bypass for Automation header.

    Every curl flag goes after `--`, since `-S` and `-d` are also short forms of the CLI's own
    options. The command and the CLI's output are never printed: they hold the token, and the CLI
    may print the bypass secret it adds.
    """

    def fetch(url: str) -> Answer:
        with tempfile.TemporaryDirectory() as scratch:
            headers_file, body_file = Path(scratch, "headers"), Path(scratch, "body")
            command = ["npx", "--yes", cli, "curl", url, "--yes", "--token", token,
                       "--", *CURL_FLAGS, "-D", str(headers_file), "-o", str(body_file)]
            try:
                result = subprocess.run(
                    command,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=CLI_TIMEOUT,
                )
            except subprocess.TimeoutExpired:
                say(f"vercel curl did not finish within {CLI_TIMEOUT}s")
                return Answer()
            if result.returncode != 0:
                say(f"vercel curl exited {result.returncode}")
                return Answer()
            return read_answer(headers_file, body_file)

    return fetch


def wait(deadline: float, interval: float) -> bool:
    """Sleep one interval, cut short by the deadline; False once the deadline has passed."""
    left = deadline - time.monotonic()
    if left <= 0:
        return False
    time.sleep(min(interval, left))
    return True


def seconds(value: float) -> str:
    return f"{value:g}s"


def prove_own(project: Project, address: str, sha: str, fetch, timeout: float, interval: float):
    """The staged deployment's answer of this commit, or the exit code of its refusal."""
    staged = f"The staged {project.name} at {address}"
    deadline = time.monotonic() + timeout
    while True:
        answer = fetch(address + project.path)
        if answer.status is not None and 400 <= answer.status < 500:
            return refuse(f"{staged} answered {answer.status} ({answer.excerpt()}).")
        if answer.status is not None and answer.status < 500:
            data = answer.json()
            if data is None:
                return refuse(f"{staged} does not report its commit ({answer.described()}).")
            if data["commit"] != sha:
                return refuse(f"{staged} reports commit {shown(data['commit'])}, not {short(sha)}: it is not this build.")
            if project.serving(data):
                return answer
        if not wait(deadline, interval):
            return refuse(f"{staged} did not serve within {seconds(timeout)}; last answer: {answer.described()}.")
        say(f"{staged} answered {answer.said}, trying again")


def prove_domain(project: Project, address: str, host: str, sha: str, fetch, timeout: float, interval: float):
    """The domain's answer once it reports this commit, or the exit code of its refusal."""
    deadline = time.monotonic() + timeout
    seen = NO_COMMIT
    while True:
        answer = fetch(address + project.path)
        data = answer.json()
        if data is not None:
            seen = data["commit"]
            if data["commit"] == sha and project.serving(data):
                return answer
        if not wait(deadline, interval):
            last = "none" if seen is NO_COMMIT else shown(seen)
            return refuse(
                f"{host} still served commit {last} after {seconds(timeout)}, not {short(sha)}; last answer: {answer.said}."
            )
        serves = shown(data["commit"]) if data is not None and data["commit"] != sha else answer.said
        say(f"{host} serves {serves}, waiting for {short(sha)}")


def check(project: Project, address: str, host: str, answer: Answer, fetch) -> List[str]:
    """What the build that reports the commit fails of its project's checks, each run once."""
    failures = [f"{host} {sentence}" for sentence in project.says(answer.json())]
    if project.page is not None:
        answer = fetch(address + project.page)
        if answer.status != 200 or b'<div id="app">' not in answer.body:
            failures.append(f"{host} serves no app at {project.page} ({answer.said})")
        if answer.status is None:
            return failures
    for names in project.headers:
        if not any(name in answer.headers for name in names):
            failures.append(f"{host} sends no {names[0]}")
    return failures


def green(sha: str, api: str, repository: str, token: str) -> int:
    query = urllib.parse.urlencode({"head_sha": sha, "event": "push", "branch": "main", "per_page": 100})
    request = urllib.request.Request(
        f"{api.rstrip('/')}/repos/{repository}/actions/workflows/test.yml/runs?{query}",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            listed = json.load(response)["workflow_runs"]
        runs = [
            run for run in listed
            if run["head_sha"] == sha and run["event"] == "push" and run["head_branch"] == "main"
        ]
        newest = max(runs, key=lambda run: run["run_number"], default=None)
    except urllib.error.HTTPError as error:
        reason = str(error.code)
    except (OSError, http.client.HTTPException, ValueError, KeyError, TypeError) as error:
        reason = type(error).__name__
    else:
        reason = None
    if reason is not None:
        return refuse(f"Could not read the Test runs for {short(sha)} from GitHub ({reason}), so nothing was deployed.")
    if newest is None:
        return refuse(f"No Test run on main at {short(sha)}. Deploy only a commit on main whose Test run has passed.")
    url = newest.get("html_url")
    if newest["status"] != "completed":
        return refuse(f"Test is still running on main at {short(sha)} ({url}). Run Deploy again once it has passed.")
    if newest["conclusion"] != "success":
        return refuse(
            f"Test {newest['conclusion']} on main at {short(sha)} ({url}). Deploy only a commit whose Test run has passed."
        )
    say(f"Test passed on main at {short(sha)}: {url}")
    return 0


def duration(text: str) -> float:
    value = float(text)
    if not value > 0:
        raise argparse.ArgumentTypeError("must be a number of seconds above 0")
    return value


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="The Deploy workflow's checks (scripts/deploy_proof.py).")
    commands = root.add_subparsers(dest="command", required=True)

    green_command = commands.add_parser("green", help="whether the Test workflow passed on main at a commit")
    green_command.add_argument("--commit", required=True)

    prove_command = commands.add_parser("prove", help="whether an address serves a commit, then its checks")
    prove_command.add_argument("--project", required=True, choices=sorted(PROJECTS))
    prove_command.add_argument("--url", required=True)
    prove_command.add_argument("--commit", required=True)
    where = prove_command.add_mutually_exclusive_group(required=True)
    where.add_argument("--own", action="store_true", help="a staged deployment's https://<name>.vercel.app address")
    where.add_argument("--domain", action="store_true", help="a production domain")
    prove_command.add_argument("--timeout", type=duration)
    prove_command.add_argument("--interval", type=duration)
    return root


def required(command: argparse.ArgumentParser, name: str) -> str:
    value = os.environ.get(name, "")
    if not value:
        command.error(f"{name} is not set")
    return value


def main(argv: Optional[List[str]] = None) -> int:
    root = parser()
    args = root.parse_args(argv)
    if args.command == "green":
        repository = required(root, "GITHUB_REPOSITORY")
        token = required(root, "GITHUB_TOKEN")
        api = os.environ.get("GITHUB_API_URL") or "https://api.github.com"
        return green(args.commit, api, repository, token)

    project = PROJECTS[args.project]
    if args.own:
        if not OWN_ADDRESS.match(args.url):
            root.error(f"--own takes a deployment's generated https://<name>.vercel.app address, not {args.url}")
        fetch = vercel_fetch(required(root, "VERCEL_CLI"), required(root, "VERCEL_TOKEN"))
        address = args.url
    else:
        fetch = fetch_plain
        address = args.url.rstrip("/")
    host = urllib.parse.urlsplit(address).netloc or address
    timeout = args.timeout or (120 if args.own else 300)
    interval = args.interval or (10 if args.own else 5)

    if args.own:
        proven = prove_own(project, address, args.commit, fetch, timeout, interval)
    else:
        proven = prove_domain(project, address, host, args.commit, fetch, timeout, interval)
    if isinstance(proven, int):
        return proven
    failures = check(project, address, host, proven, fetch)
    for failure in failures:
        refuse(failure)
    if failures:
        return 1
    say(f"{host} serves {short(args.commit)} and its checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
