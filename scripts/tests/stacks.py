"""What the stack tests share: a treehouse slot's path, whether Compose is here, an environment naming no stack, and a stubbed seed run."""

import os
import shutil
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SEED = REPO / "scripts" / "seed_fixture.sh"

# Prefixes and names of what the gate, CI and a slot's shell export to name a stack, a URL or a mail switch.
STACK_PREFIXES = ("COMPOSE_", "TH_", "TEAM_")
STACK_NAMES = {"CI", "BACKEND_URL", "FRONTEND_PORT", "FRONTEND_URL", "DISABLE_EMAIL", "DISABLE_CAPTCHA"}


def slot_path(root, number):
    """Where treehouse slot `number`'s worktree sits under `root`: the path th-compose.sh, stack.ts and seed_fixture.sh read the slot from."""
    return root / ".treehouse" / "Conventioner-abc123" / str(number) / "Conventioner"


def compose_available():
    if shutil.which("docker") is None:
        return False
    return subprocess.run(["docker", "compose", "version"], capture_output=True).returncode == 0


def clean_env(**extra):
    """The caller's environment without any stack identity, team label or mail switch: the gate exports them."""
    env = {k: v for k, v in os.environ.items() if not k.startswith(STACK_PREFIXES) and k not in STACK_NAMES}
    env.update(extra)
    return env


# A stub that logs every call: `docker`/`th-compose.sh` say the back end runs, `curl` answers the
# readiness probe with 200 and the login with nothing, so the seed stops right after its first login.
SEED_STUB = """#!/usr/bin/env bash
printf '%s %s\\n' "$(basename "$0")" "$*" >> "$CALL_LOG"
case "$(basename "$0")" in
  curl) case " $* " in *" -w "*) echo 200 ;; *) echo '{}' ;; esac ;;
  *) case " $* " in *" ps "*) echo backend ;; esac ;;
esac
exit 0
"""


def run_seed(checkout, tmp_path, *args, **env):
    """Run a copy of `seed_fixture.sh` in `checkout` with stub `docker`, `curl` and `th-compose.sh`.

    Returns the finished process and every call the stubs logged, each as "<program> <arguments>".
    """
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    for name in ("docker", "curl"):
        (bin_dir / name).write_text(SEED_STUB)
        (bin_dir / name).chmod(0o755)
    scripts = checkout / "scripts"
    scripts.mkdir(parents=True, exist_ok=True)
    shutil.copy(SEED, scripts)
    (scripts / "th-compose.sh").write_text(SEED_STUB)
    (scripts / "th-compose.sh").chmod(0o755)
    log = tmp_path / "calls.log"
    log.write_text("")
    result = subprocess.run(
        [str(scripts / "seed_fixture.sh"), *args],
        env=clean_env(PATH=f"{bin_dir}:{os.environ['PATH']}", CALL_LOG=str(log), **env),
        capture_output=True,
        text=True,
    )
    return result, log.read_text().splitlines()
