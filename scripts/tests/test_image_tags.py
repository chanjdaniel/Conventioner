"""image-tags.sh run for real on fixture copies of the images' build inputs."""

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest
from build_inputs import BACKEND_INPUTS, FRONTEND_INPUTS, copy_build_inputs

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "scripts" / "image-tags.sh"


@pytest.fixture
def worktree(tmp_path):
    return copy_build_inputs(tmp_path / "a" / "Conventioner")


def tags(worktree, path=None):
    env = dict(os.environ)
    if path is not None:
        env["PATH"] = path
    result = subprocess.run([str(SCRIPT), str(worktree)], env=env, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    return dict(line.split("=", 1) for line in result.stdout.splitlines())


def test_it_prints_a_short_tag_for_each_image(worktree):
    printed = tags(worktree)

    assert set(printed) == {"TH_BACKEND_TAG", "TH_FRONTEND_TAG"}
    for tag in printed.values():
        assert re.fullmatch(r"[0-9a-f]{12}", tag)
    assert printed["TH_BACKEND_TAG"] != printed["TH_FRONTEND_TAG"]


def test_the_same_inputs_give_the_same_tags_wherever_the_worktree_is(worktree, tmp_path):
    other = copy_build_inputs(tmp_path / "b" / "elsewhere")

    assert tags(worktree) == tags(other)


@pytest.mark.parametrize(
    "name, changed",
    [(name, "TH_BACKEND_TAG") for name in BACKEND_INPUTS] + [(name, "TH_FRONTEND_TAG") for name in FRONTEND_INPUTS],
)
def test_changing_an_input_changes_only_its_images_tag(worktree, name, changed):
    before = tags(worktree)
    with open(worktree / name, "a") as f:
        f.write("\n# changed\n")

    after = tags(worktree)

    assert {var for var in before if before[var] != after[var]} == {changed}


def test_changing_the_lockfile_changes_only_the_frontend_tag(worktree):
    before = tags(worktree)
    lock = worktree / "front-end" / "package-lock.json"
    lock.write_text(lock.read_text().replace('"lockfileVersion"', '"lockfileVersion "', 1))

    after = tags(worktree)

    assert after["TH_BACKEND_TAG"] == before["TH_BACKEND_TAG"]
    assert after["TH_FRONTEND_TAG"] != before["TH_FRONTEND_TAG"]


def test_source_code_is_not_an_input(worktree):
    # The code reaches a container through its bind mount, so a change to it needs no new image.
    before = tags(worktree)
    (worktree / "back-end" / "app.py").write_text("print('changed')\n")
    (worktree / "front-end" / "src").mkdir()
    (worktree / "front-end" / "src" / "main.ts").write_text("export {}\n")

    assert tags(worktree) == before


def test_a_missing_input_is_refused_by_name(worktree):
    (worktree / "back-end" / "requirements-floorplan-solver.txt").unlink()

    result = subprocess.run([str(SCRIPT), str(worktree)], capture_output=True, text=True)

    assert result.returncode == 1
    assert result.stdout == ""
    assert "back-end/requirements-floorplan-solver.txt" in result.stderr


@pytest.mark.skipif(shutil.which("shasum") is None, reason="shasum is not installed")
def test_shasum_gives_the_same_tags_where_there_is_no_sha256sum(worktree, tmp_path):
    # macOS has shasum and no sha256sum.
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for tool in ("bash", "shasum", "perl"):
        (bin_dir / tool).symlink_to(shutil.which(tool))

    assert tags(worktree, path=str(bin_dir)) == tags(worktree)
