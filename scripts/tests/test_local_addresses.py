"""Every host-side client dials 127.0.0.1, on a port no macOS service holds.

Every stack publishes on 127.0.0.1 only. A client dialling `localhost` tries ::1 first, and macOS
hands a port held on 127.0.0.1 to any IPv6 listen(0), so for as long as some other program listens
there, `localhost:<port>` reaches it instead of the stack (T48: the gate's EPROTO "unexpected
message" and ERR_INVALID_HTTP_RESPONSE). And macOS's AirPlay Receiver holds 5000 on both families.

The clients are run for real: `stack.ts` (whose URLs Playwright and the suite use) under Node,
`seed_fixture.sh` with a stub `docker` and `curl` that log what they were asked to dial, and the
stacks' ports are read from Compose's own rendering of them.
"""

import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from urllib.parse import urlsplit

import pytest
from stacks import clean_env, compose_available, run_seed, slot_path

REPO = Path(__file__).resolve().parents[2]
STACK_TS = REPO / "front-end" / "e2e" / "helpers" / "stack.ts"

# Ports macOS's own services listen on, any of which a default port must stay off.
MACOS_PORTS = {
    5000: "AirPlay Receiver",
    7000: "AirPlay Receiver",
    3283: "Remote Management",
    5900: "Screen Sharing",
    445: "File Sharing (SMB)",
    548: "File Sharing (AFP)",
    631: "Printer Sharing",
    3689: "Music Sharing",
}


def stack_identity(cwd, **env):
    """What `stack.ts` says the stack is, run under Node from `cwd`, with the URL Playwright browses."""
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            "const { detectStack, frontendURL } = await import(process.argv[1]);"
            "const identity = detectStack();"
            "console.log(JSON.stringify({ ...identity, frontendURL: frontendURL(identity.frontendPort) }));",
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
    worktree = slot_path(root, number)
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
    assert identity["frontendURL"] == f"http://127.0.0.1:{identity['frontendPort']}"


def seed_dials(checkout, tmp_path, *args):
    """The URLs `seed_fixture.sh`, copied into `checkout`, dials before its login comes back empty."""
    result, calls = run_seed(checkout, tmp_path, *args)
    assert "Could not extract user ID" in result.stdout, result.stdout + result.stderr
    curls = [call for call in calls if call.startswith("curl ")]
    return {match for call in curls for match in re.findall(r"\w+://[^/\s]+", call)}


@pytest.mark.parametrize("where", ["primary", "slot"])
def test_seed_fixture_dials_127_0_0_1(tmp_path, where):
    if where == "slot":
        dialled = seed_dials(slot_dir(tmp_path, 3), tmp_path)
    else:
        dialled = seed_dials(tmp_path / "Conventioner", tmp_path, "--primary")
    assert dialled and all(url.startswith("https://127.0.0.1:") for url in dialled), dialled


compose = pytest.mark.skipif(not compose_available(), reason="docker compose is not installed")


# The primary stack as a fresh checkout renders it: a developer's own untracked .env left out.
PRIMARY = ("docker", "compose", "--env-file", os.devnull, "-f", "docker-compose.yml")


def rendered(*compose_args, env=None):
    """Each service as Compose renders the stack."""
    result = subprocess.run(
        [*compose_args, "config", "--format", "json"],
        cwd=REPO,
        env=env or clean_env(),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)["services"]


def published_ports(*compose_args, env=None):
    """Each service's published host ports, as Compose renders the stack."""
    services = rendered(*compose_args, env=env)
    return {name: [int(p["published"]) for p in svc.get("ports", []) if p.get("published")] for name, svc in services.items()}


@compose
def test_the_primary_stack_publishes_no_port_macos_holds():
    ports = published_ports(*PRIMARY, "--profile", "tools")
    held = {name: [p for p in published if p in MACOS_PORTS] for name, published in ports.items()}
    assert {name: p for name, p in held.items() if p} == {}


@compose
@node_available
def test_the_clients_dial_the_ports_the_primary_stack_publishes(tmp_path):
    ports = published_ports(*PRIMARY)
    identity = stack_identity(tmp_path, CI="1")
    assert (identity["backendPort"], identity["frontendPort"]) == (ports["backend"][0], ports["frontend"][0])
    assert seed_dials(tmp_path / "Conventioner", tmp_path, "--primary") == {f"https://127.0.0.1:{ports['backend'][0]}"}


@compose
def test_the_primary_stack_s_email_links_point_at_127_0_0_1():
    frontend_url = rendered(*PRIMARY)["backend"]["environment"]["FRONTEND_URL"]
    assert urlsplit(frontend_url).hostname == "127.0.0.1", frontend_url


@compose
@node_available
def test_stack_ts_dials_the_ports_a_slot_stack_publishes(tmp_path):
    worktree = slot_dir(tmp_path, 3)
    shutil.copy(REPO / "docker-compose.yml", worktree)
    from build_inputs import copy_build_inputs

    copy_build_inputs(worktree)
    ports = published_ports(str(REPO / "scripts" / "th-compose.sh"), env=clean_env(TH_DIR=str(worktree)))
    identity = stack_identity(worktree)
    assert (identity["backendPort"], identity["frontendPort"]) == (ports["backend"][0], ports["frontend"][0])
    assert all(p not in MACOS_PORTS for published in ports.values() for p in published)
