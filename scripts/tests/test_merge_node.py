"""merge_node.py run as git runs a merge driver, on three versions of a node, and installed in a throwaway
repository that then merges two branches for real."""

import importlib.util
import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
DRIVER = REPO / "scripts" / "merge_node.py"
LABELS = ("HEAD", "1234abc", "origin/dev")  # %X, %S, %Y: ours, the ancestor, theirs


def node(describes=("back-end/guards.py",), verified="2026-10-20", sources=("E31/F01",), body="Body.\n", kind="rule"):
    lines = ["---", "layer: business", f"kind: {kind}"]
    if describes is not None:
        lines += ["describes:", *(f"  - {item}" for item in describes)]
    lines.append(f"verified: {verified}")
    if sources is not None:
        lines += ["sources:", *(f"  - {item}" for item in sources)]
    return "\n".join([*lines, "---", "", "# A rule", "", body])


def write_versions(tmp_path, ancestor, ours, theirs, conflict_style=None):
    """The work tree git runs the driver from, holding the three temporary files."""
    work = tmp_path / "work"
    if not work.exists():
        subprocess.run(["git", "init", "-q", str(work)], check=True)
    if conflict_style:
        subprocess.run(["git", "-C", str(work), "config", "merge.conflictStyle", conflict_style], check=True)
    for name, text in (("o", ancestor), ("a", ours), ("b", theirs)):
        (work / name).write_bytes(text.encode("utf-8"))
    return work


def driver_args():
    ours_label, ancestor_label, theirs_label = LABELS
    return ["o", "a", "b", "7", "docs/business/rules/a-rule.md", ancestor_label, ours_label, theirs_label]


def merge(tmp_path, ancestor, ours, theirs, conflict_style=None):
    """Run the driver as git does: from the work tree's top, on three temporary files, ours overwritten."""
    work = write_versions(tmp_path, ancestor, ours, theirs, conflict_style)
    result = subprocess.run(["python3", str(DRIVER), *driver_args()], cwd=work, capture_output=True, text=True)
    return result.returncode, (work / "a").read_bytes().decode("utf-8")


def git_merge_file(tmp_path, ancestor, ours, theirs):
    """What git's own text merge makes of the same three versions."""
    files = tmp_path / "plain"
    files.mkdir()
    for name, text in (("o", ancestor), ("a", ours), ("b", theirs)):
        (files / name).write_bytes(text.encode("utf-8"))
    ours_label, ancestor_label, theirs_label = LABELS
    labels = ["-L", ours_label, "-L", ancestor_label, "-L", theirs_label]
    result = subprocess.run(["git", "merge-file", "-p", *labels, "a", "o", "b"], cwd=files, capture_output=True)
    return result.stdout.decode("utf-8")


def test_two_sides_appending_different_ids_keep_both(tmp_path):
    ancestor = node(sources=("E31/F01", "E34/F01"))
    ours = node(sources=("E31/F01", "E34/F01", "E41/F01/S02"))
    theirs = node(sources=("E31/F01", "E34/F01", "E40/F01/S03"))

    status, merged = merge(tmp_path, ancestor, ours, theirs)

    assert status == 0
    assert merged == node(sources=("E31/F01", "E34/F01", "E41/F01/S02", "E40/F01/S03"))


def test_describes_merges_as_a_set_too(tmp_path):
    ancestor = node(describes=("back-end/guards.py",))
    ours = node(describes=("back-end/guards.py", "back-end/api/markets.py#setup_lock_reason"))
    theirs = node(describes=("back-end/guards.py", "front-end/src/stores/market.ts"))

    status, merged = merge(tmp_path, ancestor, ours, theirs)

    assert status == 0
    assert merged == node(
        describes=("back-end/guards.py", "back-end/api/markets.py#setup_lock_reason", "front-end/src/stores/market.ts")
    )


def test_an_id_one_side_removed_stays_removed(tmp_path):
    ancestor = node(sources=("E31/F01", "E34/F01", "E35/F02"))
    ours = node(sources=("E31/F01", "E35/F02"))
    theirs = node(sources=("E31/F01", "E34/F01", "E35/F02", "E40/F01/S03"))

    status, merged = merge(tmp_path, ancestor, ours, theirs)

    assert status == 0
    assert merged == node(sources=("E31/F01", "E35/F02", "E40/F01/S03"))


def test_an_id_both_sides_added_is_kept_once(tmp_path):
    ancestor = node(sources=("E31/F01",))
    ours = node(sources=("E31/F01", "E40/F01"))
    theirs = node(sources=("E31/F01", "E40/F01", "E41/F02"))

    status, merged = merge(tmp_path, ancestor, ours, theirs)

    assert status == 0
    assert merged == node(sources=("E31/F01", "E40/F01", "E41/F02"))


def test_a_list_both_sides_started_holds_both_sides_items(tmp_path):
    ancestor = node(describes=None)
    ours = node(describes=("back-end/guards.py",))
    theirs = node(describes=("back-end/api/markets.py",))

    status, merged = merge(tmp_path, ancestor, ours, theirs)

    assert status == 0
    assert merged == node(describes=("back-end/guards.py", "back-end/api/markets.py"))


@pytest.mark.parametrize(("ours_day", "theirs_day"), [("2026-10-30", "2026-10-28"), ("2026-10-28", "2026-10-30")])
def test_the_later_verified_wins(tmp_path, ours_day, theirs_day):
    ancestor = node(verified="2026-10-20", sources=("E31/F01",))
    ours = node(verified=ours_day, sources=("E31/F01", "E41/F01/S02"))
    theirs = node(verified=theirs_day, sources=("E31/F01", "E40/F01/S03"))

    status, merged = merge(tmp_path, ancestor, ours, theirs)

    assert status == 0
    assert merged == node(verified="2026-10-30", sources=("E31/F01", "E41/F01/S02", "E40/F01/S03"))


def test_a_body_conflict_still_conflicts_with_the_lists_merged(tmp_path):
    ancestor = node(sources=("E31/F01",), body="The rule holds.\n")
    ours = node(sources=("E31/F01", "E41/F01/S02"), body="The rule holds for an Admin.\n")
    theirs = node(sources=("E31/F01", "E40/F01/S03"), body="The rule holds for an Owner.\n")

    status, merged = merge(tmp_path, ancestor, ours, theirs)

    assert status == 1
    head, _, rest = merged.partition("<<<<<<<")
    assert head == node(sources=("E31/F01", "E41/F01/S02", "E40/F01/S03"), body="")
    assert rest == (
        " HEAD\nThe rule holds for an Admin.\n=======\nThe rule holds for an Owner.\n>>>>>>> origin/dev\n"
    )


def test_a_conflict_follows_the_configured_conflict_style(tmp_path):
    ancestor = node(body="The rule holds.\n")
    ours = node(body="The rule holds for an Admin.\n")
    theirs = node(body="The rule holds for an Owner.\n")

    status, merged = merge(tmp_path, ancestor, ours, theirs, conflict_style="diff3")

    assert status == 1
    assert "||||||| 1234abc\nThe rule holds.\n=======\n" in merged


def test_another_key_changed_both_ways_conflicts_as_git_would(tmp_path):
    ancestor = node(kind="rule", sources=("E31/F01",))
    ours = node(kind="flow", sources=("E31/F01", "E41/F01/S02"))
    theirs = node(kind="concept", sources=("E31/F01", "E40/F01/S03"))

    status, merged = merge(tmp_path, ancestor, ours, theirs)

    assert status == 1
    assert "<<<<<<< HEAD\nkind: flow\n=======\nkind: concept\n>>>>>>> origin/dev\n" in merged
    assert "sources:\n  - E31/F01\n  - E41/F01/S02\n  - E40/F01/S03\n---\n" in merged


def test_a_list_one_side_dropped_while_the_other_added_to_it_conflicts(tmp_path):
    ancestor = node(describes=("back-end/guards.py",))
    ours = node(describes=None)
    theirs = node(describes=("back-end/guards.py", "back-end/api/markets.py"))

    status, merged = merge(tmp_path, ancestor, ours, theirs)

    assert status == 1
    assert merged == git_merge_file(tmp_path, ancestor, ours, theirs)


@pytest.mark.parametrize(
    ("ours_body", "theirs_body", "status"),
    [
        ("One, ours.\nTwo.\nThree.\nFour.\n", "One.\nTwo.\nThree.\nFour, theirs.\n", 0),
        ("Ours.\n", "Theirs.\n", 1),
    ],
)
def test_a_file_with_no_frontmatter_merges_as_text(tmp_path, ours_body, theirs_body, status):
    ancestor = "# A hub\n\nOne.\nTwo.\nThree.\nFour.\n"
    ours = "# A hub\n\n" + ours_body
    theirs = "# A hub\n\n" + theirs_body

    merged_status, merged = merge(tmp_path, ancestor, ours, theirs)

    assert merged_status == status
    assert merged == git_merge_file(tmp_path, ancestor, ours, theirs)


def crlf(text):
    return text.replace("\n", "\r\n")


def test_a_node_with_crlf_endings_keeps_them(tmp_path):
    ancestor = crlf(node(verified="2026-10-20", sources=("E31/F01",)))
    ours = crlf(node(verified="2026-10-28", sources=("E31/F01", "E41/F01/S02")))
    theirs = crlf(node(verified="2026-10-30", sources=("E31/F01", "E40/F01/S03")))

    status, merged = merge(tmp_path, ancestor, ours, theirs)

    assert status == 0
    assert merged == crlf(node(verified="2026-10-30", sources=("E31/F01", "E41/F01/S02", "E40/F01/S03")))


def test_a_crlf_file_with_no_frontmatter_merges_as_git_does(tmp_path):
    ancestor = crlf("# A hub\n\nOne.\nTwo.\nThree.\nFour.\n")
    ours = crlf("# A hub\n\nOne, ours.\nTwo.\nThree.\nFour.\n")
    theirs = crlf("# A hub\n\nOne.\nTwo.\nThree.\nFour, theirs.\n")

    status, merged = merge(tmp_path, ancestor, ours, theirs)

    assert status == 0
    assert merged == git_merge_file(tmp_path, ancestor, ours, theirs)
    assert merged == crlf("# A hub\n\nOne, ours.\nTwo.\nThree.\nFour, theirs.\n")


def test_a_driver_that_fails_still_merges_as_text(tmp_path, monkeypatch):
    spec = importlib.util.spec_from_file_location("merge_node", DRIVER)
    driver = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(driver)

    def broken(texts):
        raise RuntimeError("a bug in the set merge")

    monkeypatch.setattr(driver, "settle", broken)
    ancestor = node(sources=("E31/F01",), body="The rule holds.\n")
    ours = node(sources=("E31/F01", "E41/F01/S02"), body="The rule holds.\n")
    theirs = node(sources=("E31/F01", "E40/F01/S03"), body="The rule holds for an Owner.\n")
    work = write_versions(tmp_path, ancestor, ours, theirs)
    monkeypatch.chdir(work)

    status = driver.main(driver_args())

    assert status == 1
    assert (work / "a").read_bytes().decode("utf-8") == git_merge_file(tmp_path, ancestor, ours, theirs)


# ── A real merge, the driver installed as a checkout installs it ─────────────


def git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)


def commit(repo, message):
    git(repo, "add", "-A")
    result = git(repo, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--no-verify", "-m", message)
    assert result.returncode == 0, result.stderr


@pytest.fixture
def repo(tmp_path):
    repo = tmp_path / "Conventioner"
    (repo / "scripts").mkdir(parents=True)
    shutil.copy(DRIVER, repo / "scripts" / "merge_node.py")
    shutil.copy(REPO / ".gitattributes", repo / ".gitattributes")
    (repo / "docs" / "business" / "rules").mkdir(parents=True)
    (repo / "docs" / "business" / "rules" / "a-rule.md").write_text(node(sources=("E31/F01",)))
    git(repo, "init", "-q", "-b", "dev")
    commit(repo, "base")
    return repo


def branch(repo, name, sources, base="dev"):
    git(repo, "checkout", "-q", "-b", name, base)
    (repo / "docs" / "business" / "rules" / "a-rule.md").write_text(node(sources=sources))
    commit(repo, name)


def test_install_registers_the_driver_once(repo):
    for _ in range(2):
        result = subprocess.run(["python3", "scripts/merge_node.py", "install"], cwd=repo, capture_output=True, text=True)
        assert result.returncode == 0, result.stderr

    drivers = git(repo, "config", "--get-all", "merge.kg-node.driver").stdout.splitlines()
    assert drivers == ["python3 scripts/merge_node.py %O %A %B %L %P %S %X %Y"]


def test_installing_again_writes_nothing(repo):
    subprocess.run(["python3", "scripts/merge_node.py", "install"], cwd=repo, check=True)
    config = repo / ".git" / "config"
    before = (config.read_bytes(), config.stat().st_mtime_ns, config.stat().st_ino)

    subprocess.run(["python3", "scripts/merge_node.py", "install"], cwd=repo, check=True)

    assert (config.read_bytes(), config.stat().st_mtime_ns, config.stat().st_ino) == before


def test_two_branches_appending_ids_merge_clean_once_installed(repo):
    subprocess.run(["python3", "scripts/merge_node.py", "install"], cwd=repo, check=True)
    branch(repo, "story-a", ("E31/F01", "E41/F01/S02"))
    branch(repo, "story-b", ("E31/F01", "E40/F01/S03"))

    result = git(repo / "docs", "merge", "--no-edit", "story-a")

    assert result.returncode == 0, result.stdout + result.stderr
    merged = (repo / "docs" / "business" / "rules" / "a-rule.md").read_text()
    assert merged == node(sources=("E31/F01", "E40/F01/S03", "E41/F01/S02"))


def test_without_the_driver_installed_the_same_merge_conflicts(repo):
    branch(repo, "story-a", ("E31/F01", "E41/F01/S02"))
    branch(repo, "story-b", ("E31/F01", "E40/F01/S03"))

    result = git(repo, "merge", "--no-edit", "story-a")

    assert result.returncode == 1
    assert "CONFLICT (content): Merge conflict in docs/business/rules/a-rule.md" in result.stdout
