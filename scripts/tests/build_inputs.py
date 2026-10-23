"""The files each shared image is built from, as image-tags.sh hashes them, for tests that need a worktree."""

import shutil
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

BACKEND_INPUTS = (
    "back-end/Dockerfile",
    "back-end/docker-entrypoint.sh",
    "back-end/requirements.txt",
    "back-end/requirements-floorplan-solver.txt",
)
FRONTEND_INPUTS = ("front-end/Dockerfile", "front-end/package.json", "front-end/package-lock.json")


def copy_build_inputs(worktree):
    """Copy the repository's build inputs into a worktree; returns the worktree."""
    for name in BACKEND_INPUTS + FRONTEND_INPUTS:
        (worktree / name).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(REPO / name, worktree / name)
    return worktree
