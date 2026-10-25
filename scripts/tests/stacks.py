"""What the stack tests share: a treehouse slot's path, whether Compose is here, and an environment naming no stack."""

import os
import shutil
import subprocess

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
