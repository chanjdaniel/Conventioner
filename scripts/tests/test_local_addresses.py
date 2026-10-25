"""Every host-side client dials 127.0.0.1.

Every stack publishes on 127.0.0.1 only. A client dialling `localhost` tries ::1 first, and macOS
hands a port held on 127.0.0.1 to any IPv6 listen(0), so for as long as some other program listens
there, `localhost:<port>` reaches it instead of the stack (T48: the gate's EPROTO "unexpected
message" and ERR_INVALID_HTTP_RESPONSE).

The clients are run for real: `stack.ts` under Node, `seed_fixture.sh` with a stub `docker` and
`curl` that log what they were asked to dial.
"""

import json
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
STACK_TS = REPO / "front-end" / "e2e" / "helpers" / "stack.ts"
SEED = REPO / "scripts" / "seed_fixture.sh"

# Files that may name localhost in a URL: what release-please and past records wrote, and the test
# that the back end still allows a browser on a localhost origin.
LOCALHOST_ALLOWED = ("CHANGELOG.md", "docs/records/", "back-end/tests/test_cors.py")


def tracked_text_files():
    names = subprocess.run(
        ["git", "ls-files", "-z"], cwd=REPO, capture_output=True, text=True, check=True
    ).stdout.split("\0")
    for name in filter(None, names):
        path = REPO / name
        if not path.is_file():
            continue
        try:
            yield name, path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue


def test_no_tracked_file_names_localhost_in_a_url():
    found = [
        f"{name}:{number}: {line.strip()}"
        for name, text in tracked_text_files()
        if not name.startswith(LOCALHOST_ALLOWED)
        for number, line in enumerate(text.splitlines(), 1)
        if "://" + "localhost" in line
    ]
    assert found == [], "a stack listens on 127.0.0.1 only, so dial that:\n" + "\n".join(found)


def clean_env(**extra):
    """The caller's environment without any stack identity: the gate and a slot's shell export one."""
    env = {
        k: v
        for k, v in os.environ.items()
        if not k.startswith(("COMPOSE_", "TH_", "TEAM_")) and k not in {"CI", "BACKEND_URL", "FRONTEND_PORT"}
    }
    env.update(extra)
    return env


def stack_identity(cwd, **env):
    """What `stack.ts` says the stack is, run under Node from `cwd`."""
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            "const { detectStack } = await import(process.argv[1]);"
            "console.log(JSON.stringify(detectStack()));",
            STACK_TS.as_uri(),
        ],
        cwd=cwd,
        env=clean_env(**env),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


node_available = pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")


def slot_dir(root, number):
    worktree = root / ".treehouse" / "Conventioner-abc123" / str(number) / "Conventioner"
    worktree.mkdir(parents=True)
    return worktree


@node_available
@pytest.mark.parametrize(
    "where, env",
    [
        ("plain", {"CI": "1"}),
        ("slot", {}),
        ("plain", {"COMPOSE_PROJECT_NAME": "nmtest-1", "TH_BACKEND_PORT": "49154", "TH_FRONTEND_PORT": "49155"}),
    ],
    ids=["ci", "treehouse-slot", "th-compose-exports"],
)
def test_stack_ts_dials_127_0_0_1(tmp_path, where, env):
    cwd = slot_dir(tmp_path, 3) if where == "slot" else tmp_path
    identity = stack_identity(cwd, **env)
    assert identity["backendURL"] == f"https://127.0.0.1:{identity['backendPort']}"


# A stub that logs every call: `docker`/`th-compose.sh` say the back end runs, `curl` answers the
# readiness probe with 200 and the login with nothing, so the seed stops right after its first login.
STUB = """#!/usr/bin/env bash
printf '%s %s\\n' "$(basename "$0")" "$*" >> "$CALL_LOG"
case "$(basename "$0")" in
  curl) case " $* " in *" -w "*) echo 200 ;; *) echo '{}' ;; esac ;;
  *) case " $* " in *" ps "*) echo backend ;; esac ;;
esac
exit 0
"""


def seed_dials(checkout, tmp_path):
    """The URLs `seed_fixture.sh`, copied into `checkout`, dials before its login comes back empty."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name in ("docker", "curl"):
        (bin_dir / name).write_text(STUB)
        (bin_dir / name).chmod(0o755)
    scripts = checkout / "scripts"
    scripts.mkdir(parents=True, exist_ok=True)
    shutil.copy(SEED, scripts)
    (scripts / "th-compose.sh").write_text(STUB)
    (scripts / "th-compose.sh").chmod(0o755)
    log = tmp_path / "calls.log"
    result = subprocess.run(
        [str(scripts / "seed_fixture.sh")],
        env=clean_env(PATH=f"{bin_dir}:{os.environ['PATH']}", CALL_LOG=str(log)),
        capture_output=True,
        text=True,
    )
    assert "Could not extract user ID" in result.stdout, result.stdout + result.stderr
    calls = [line for line in log.read_text().splitlines() if line.startswith("curl ")]
    return {match for call in calls for match in re.findall(r"\w+://[^/\s]+", call)}


@pytest.mark.parametrize("where", ["primary", "slot"])
def test_seed_fixture_dials_127_0_0_1(tmp_path, where):
    checkout = slot_dir(tmp_path, 3) if where == "slot" else tmp_path / "Conventioner"
    dialled = seed_dials(checkout, tmp_path)
    assert dialled and all(url.startswith("https://127.0.0.1:") for url in dialled), dialled
