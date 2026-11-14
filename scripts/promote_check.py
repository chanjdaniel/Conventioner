#!/usr/bin/env python3
"""Whether a commit may be promoted to `main` (T317): the Promote workflow's checks.

    promote_check.py --commit <sha>

It reads GitHub and writes nothing, so it can be run anywhere without promoting. The checks, in
order, each refusal one `::error::` line:

1. The Test workflow passed on a push to `dev` at the commit: the newest run by `run_number`
   decides, read by scripts/github_runs.py as Deploy reads `main`'s. No run, a run still going or
   any conclusion but `success` refuses.
2. The commit is on `dev`: GitHub's compare of `dev...<sha>` says `behind` or `identical`.
3. `main` is its ancestor: the compare of `main...<sha>` says `ahead`, so moving `main` to it is a
   fast-forward. `identical` (already there), `behind` (older than `main`) and `diverged` (most
   often the release commit, not yet merged back into `dev`) each refuse with their own line.

The commit must be a full 40-character sha (upper case is read as lower), so a short or ambiguous
one never resolves to the wrong commit. Any error reading GitHub refuses at once, with no retry.
Needs GITHUB_REPOSITORY and GITHUB_TOKEN; GITHUB_API_URL defaults to https://api.github.com.

Exit codes: 0 may be promoted, 1 refused, 2 a usage error. Nothing printed holds the token.
"""
import argparse
import os
import re
import sys
from typing import List, Optional

import github_runs

FULL_SHA = re.compile(r"^[0-9a-f]{40}$")
SHOWN = 80
COMPARED = {"ahead", "behind", "identical", "diverged"}


def say(line: str) -> None:
    print(line, flush=True)


def refuse(sentence: str) -> int:
    say(f"::error::{sentence}")
    return 1


def short(sha: str) -> str:
    return sha[:12]


def unreadable(what: str, reason: str) -> int:
    return refuse(f"Could not read {what} from GitHub ({reason}), so nothing was promoted.")


def comparison(data) -> dict:
    """What a compare answer says of the head against the base; raises on an answer unlike GitHub's."""
    status = data["status"]
    if status not in COMPARED:
        raise ValueError(status)
    ahead_by, base = data["ahead_by"], data["base_commit"]["sha"]
    if not isinstance(ahead_by, int) or not isinstance(base, str):
        raise TypeError(ahead_by, base)
    return {"status": status, "ahead_by": ahead_by, "base": base}


def compare(base: str, sha: str, api: str, repository: str, token: str):
    return github_runs.read(api, f"/repos/{repository}/compare/{base}...{sha}", token, comparison)


def promote_check(sha: str, api: str, repository: str, token: str) -> int:
    newest, reason = github_runs.newest_run(sha, "dev", api, repository, token)
    if reason is not None:
        return unreadable(f"the Test runs for {short(sha)}", reason)
    if newest is None:
        return refuse(f"No Test run on a push to dev at {short(sha)}. Promote only a commit on dev whose Test run has passed.")
    url = newest.get("html_url")
    if newest["status"] != "completed":
        return refuse(f"Test is still running on dev at {short(sha)} ({url}). Run Promote again once it has passed.")
    if newest["conclusion"] != "success":
        return refuse(
            f"Test {newest['conclusion']} on dev at {short(sha)} ({url}). Promote only a commit whose Test run has passed."
        )

    on_dev, reason = compare("dev", sha, api, repository, token)
    if reason is not None:
        return unreadable(f"the comparison of {short(sha)} with dev", reason)
    if on_dev["status"] not in ("behind", "identical"):
        return refuse(f"{short(sha)} is not on dev. Promote only a commit on dev.")

    from_main, reason = compare("main", sha, api, repository, token)
    if reason is not None:
        return unreadable(f"the comparison of {short(sha)} with main", reason)
    main = short(from_main["base"])
    if from_main["status"] == "identical":
        return refuse(f"main is already at {short(sha)}; nothing to promote.")
    if from_main["status"] == "behind":
        return refuse(f"{short(sha)} is older than main ({main}); nothing to promote.")
    if from_main["status"] == "diverged":
        return refuse(
            f"main ({main}) has commits {short(sha)} lacks, so main cannot be fast-forwarded to it."
            " If it is the release commit, merge main back into dev first (docs/RELEASING.md, step 6),"
            " then promote a dev commit that has it."
        )

    behind = from_main["ahead_by"]
    commits = "commit" if behind == 1 else "commits"
    say(f"{short(sha)} may be promoted: Test passed on dev ({url}), and main ({main}) is {behind} {commits} behind it.")
    return 0


def required(command: argparse.ArgumentParser, name: str) -> str:
    value = os.environ.get(name, "")
    if not value:
        command.error(f"{name} is not set")
    return value


def main(argv: Optional[List[str]] = None) -> int:
    root = argparse.ArgumentParser(description="Whether a commit may be promoted to main (scripts/promote_check.py).")
    root.add_argument("--commit", required=True, help="the full 40-character sha of the dev commit to promote")
    args = root.parse_args(argv)
    sha = args.commit.lower()
    if not FULL_SHA.match(sha):
        root.error(f"--commit takes a commit's full 40-character sha, not {args.commit[:SHOWN]}")
    repository = required(root, "GITHUB_REPOSITORY")
    token = required(root, "GITHUB_TOKEN")
    api = os.environ.get("GITHUB_API_URL") or "https://api.github.com"
    return promote_check(sha, api, repository, token)


if __name__ == "__main__":
    sys.exit(main())
