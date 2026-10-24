"""real_data_check.py, run as the hooks, the gate and CI run it: against a git repository of the
test's own, on fake data only. The "real export" here is a CSV the test writes into that
repository's ignored .scratch/examples/."""

import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
CHECKER = REPO / "scripts" / "real_data_check.py"
BASH = shutil.which("bash")


def at(local, domain):
    """An address, built at run time: written out, the hooks would refuse this file."""
    return f"{local}@{domain}"


# Invented, in the shapes the checker refuses.
GMAIL = at("jordan.vance88", "gmail.com")
REAL_PHONE = ("604", "382", "7719")

# A fake export in the shape of a Google Form's: one applicant who looks entirely like a fixture,
# so only the exact-value check can catch them, and three who share a placeholder name.
FAKE_EXPORT = """\
Timestamp,Email Address,Full name,Business name,Phone number
9/27/2025 9:04:01,wren.okafor@example.com,Wren Okafor,Ember Kiln Pottery,(604) 555-0142
9/27/2025 9:05:12,a@example.org,Not Applicable,Shop A,
9/27/2025 9:06:40,b@example.org,Not Applicable,Shop B,
9/27/2025 9:07:03,c@example.org,Not Applicable,Shop C,
"""


def git(cwd, *args, check=True, **kwargs):
    return subprocess.run(["git", *args], cwd=cwd, check=check, text=True, capture_output=True, **kwargs)


def make_repo(path):
    path.mkdir(parents=True)
    git(path, "init", "-q", "-b", "dev")
    git(path, "config", "user.name", "Test")
    git(path, "config", "user.email", "test@example.com")
    git(path, "config", "commit.gpgsign", "false")
    (path / ".gitignore").write_text(".scratch/\n")
    (path / "README.md").write_text("A repository of the test's own.\n")
    git(path, "add", ".")
    git(path, "commit", "-q", "-m", "chore: start")
    return path


@pytest.fixture
def repo(tmp_path):
    return make_repo(tmp_path / "repo")


def check(repo, *args, stdin=None):
    return subprocess.run(
        [sys.executable, str(CHECKER), *args],
        cwd=repo,
        input=stdin,
        text=True,
        capture_output=True,
    )


def stage(repo, name, text):
    path = repo / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    git(repo, "add", "-f", name)


def commit(repo, name, text, message="test: add a file"):
    stage(repo, name, text)
    git(repo, "commit", "-q", "--no-verify", "-m", message)
    return git(repo, "rev-parse", "HEAD").stdout.strip()


def with_fake_export(repo):
    examples = repo / ".scratch" / "examples"
    examples.mkdir(parents=True)
    (examples / "responses.csv").write_text(FAKE_EXPORT)


# --- Shapes ----------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "line",
    [
        f'email = "{GMAIL}"',
        f"Contact: Jordan <{at('jordan.vance88', 'hotmail.ca')}>",
        f"{at('jordan', 'kilnandco.ca')} wrote in",
    ],
)
def test_an_address_outside_the_fixture_domains_fails(repo, line):
    stage(repo, "notes/contacts.txt", f"first\n{line}\n")

    result = check(repo, "staged")

    assert result.returncode == 1
    assert "notes/contacts.txt:2:" in result.stdout
    assert "email address outside the fixture domains" in result.stdout


@pytest.mark.parametrize(
    "address",
    [
        "vendor@example.com",
        "Organizer@Example.COM",
        "a@sub.example.org",
        "nadia@ember.test",
        "owner@market.test",
        "dan@x.com",
        "nadia@ember.ca",
        "registration@conventioner.io",
        "onboarding@resend.dev",
        "12345+someone@users.noreply.github.com",
    ],
)
def test_a_fixture_address_passes(repo, address):
    stage(repo, "tests/test_people.py", f'EMAIL = "{address}"\n')

    result = check(repo, "staged")

    assert result.returncode == 0, result.stdout
    assert result.stdout == ""


@pytest.mark.parametrize("text", ["logo@2x.png", "actions/checkout@v5", "vue@3.5.13", "@primevue/themes"])
def test_what_only_looks_like_an_address_passes(repo, text):
    stage(repo, "notes.md", f"{text}\n")

    assert check(repo, "staged").returncode == 0


@pytest.mark.parametrize(
    "phone", [shape.format(*REAL_PHONE) for shape in ("({}) {}-{}", "{}-{}-{}", "+1 {} {} {}", "{}.{}.{}")]
)
def test_a_phone_number_shaped_like_a_real_one_fails(repo, phone):
    stage(repo, "notes.md", f"Call {phone} after six\n")

    result = check(repo, "staged")

    assert result.returncode == 1
    assert "notes.md:1:" in result.stdout
    assert "phone number" in result.stdout


@pytest.mark.parametrize(
    "text",
    [
        "(604) 555-0123",
        "604-555-0199",
        "+1 604 555 0100",
        "sha256:2a7f3b9e{}{}{}12ab".format(*REAL_PHONE),
        "timestamp 1729728000123",
        "ids {}{}{} and 2026102412".format(*REAL_PHONE),
    ],
)
def test_a_fixture_phone_or_a_bare_number_passes(repo, text):
    stage(repo, "notes.md", f"{text}\n")

    assert check(repo, "staged").returncode == 0, check(repo, "staged").stdout


def test_no_matched_value_is_printed_in_full(repo):
    stage(repo, "notes.md", "{}\n({}) {}-{}\n".format(GMAIL, *REAL_PHONE))

    result = check(repo, "staged")

    out = result.stdout + result.stderr
    assert result.returncode == 1
    assert "jordan.vance88" not in out and "gmail.com" not in out
    assert REAL_PHONE[1] not in out and REAL_PHONE[2] not in out


def test_only_added_lines_count(repo):
    commit(repo, "old.md", f"{GMAIL}\n")
    git(repo, "rm", "-q", "old.md")

    assert check(repo, "staged").returncode == 0


def test_a_generated_lockfile_is_not_read(repo):
    stage(repo, "front-end/package-lock.json", f'"deprecated": "ask {at("i", "izs.me")}"\n')

    assert check(repo, "staged").returncode == 0


# --- The real exports --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "line",
    [
        "applicant: wren.okafor@example.com",
        "phone 604 555 0142",
        "6045550142",
        "{'name': 'Wren   Okafor', 'table': 4}",
        "WREN OKAFOR, Pottery",
    ],
)
def test_an_exact_value_from_a_real_export_fails(repo, line):
    with_fake_export(repo)
    stage(repo, "back-end/tests/test_data/sample.csv", f"header\n{line}\n")

    result = check(repo, "staged")

    out = result.stdout + result.stderr
    assert result.returncode == 1
    assert "back-end/tests/test_data/sample.csv:2:" in result.stdout
    assert "real export" in result.stdout
    for value in ("wren", "okafor", "0142"):
        assert value not in out.lower()


@pytest.mark.parametrize(
    "line",
    [
        "Wren is a fine name",  # one word of a name
        "not applicable",  # three applicants gave it: it identifies nobody
        "Ember Kiln Pottery",  # a business, not a person
        "owren.okafor@example.com",  # another address
    ],
)
def test_what_does_not_name_an_applicant_passes(repo, line):
    with_fake_export(repo)
    stage(repo, "notes.md", f"{line}\n")

    result = check(repo, "staged")

    assert result.returncode == 0, result.stdout


def test_a_forced_add_of_the_export_itself_fails(repo):
    with_fake_export(repo)
    git(repo, "add", "-f", ".scratch/examples/responses.csv")

    result = check(repo, "staged")

    assert result.returncode == 1
    assert ".scratch/examples/responses.csv:2:" in result.stdout


def test_a_worktree_reads_the_primary_checkouts_exports(repo, tmp_path):
    with_fake_export(repo)
    worktree = tmp_path / "worktree"
    git(repo, "worktree", "add", "-q", str(worktree), "-b", "feature")
    stage(worktree, "notes.md", "wren.okafor@example.com\n")

    result = check(worktree, "staged")

    assert result.returncode == 1
    assert "real export" in result.stdout


def test_nothing_is_written_while_reading_the_exports(repo):
    with_fake_export(repo)
    stage(repo, "notes.md", "wren.okafor@example.com\n")
    before = sorted(p for p in repo.rglob("*") if ".git" not in p.parts)

    check(repo, "staged")

    assert sorted(p for p in repo.rglob("*") if ".git" not in p.parts) == before


# --- Commits -----------------------------------------------------------------------------------


def test_a_range_names_the_commit_that_added_a_value_even_when_a_later_one_removed_it(repo):
    base = git(repo, "rev-parse", "HEAD").stdout.strip()
    added = commit(repo, "notes.md", f"{GMAIL}\n")
    git(repo, "rm", "-q", "notes.md")
    git(repo, "commit", "-q", "--no-verify", "-m", "chore: remove it")

    result = check(repo, "commits", "HEAD", "--not", base)

    assert result.returncode == 1
    assert f"{added[:12]} notes.md:1:" in result.stdout


def test_a_range_reads_commit_messages(repo):
    base = git(repo, "rev-parse", "HEAD").stdout.strip()
    sha = commit(repo, "notes.md", "fine\n", message=f"fix: reply to {GMAIL}\n\nDetails.")

    result = check(repo, "commits", "HEAD", "--not", base)

    assert result.returncode == 1
    assert f"{sha[:12]} message:1:" in result.stdout


def test_a_clean_range_passes(repo):
    base = git(repo, "rev-parse", "HEAD").stdout.strip()
    commit(repo, "notes.md", "vendor@example.com\n(604) 555-0123\n")

    result = check(repo, "commits", "HEAD", "--not", base)

    assert result.returncode == 0, result.stdout


def test_a_merge_is_held_to_what_it_adds_itself(repo):
    git(repo, "checkout", "-q", "-b", "side")
    commit(repo, "side.md", f"{GMAIL}\n")
    git(repo, "checkout", "-q", "dev")
    commit(repo, "main.md", "fine\n")
    git(repo, "merge", "-q", "--no-ff", "--no-edit", "side")

    clean = check(repo, "commits", "HEAD", "--not", "HEAD^1", "HEAD^2")
    git(repo, "rm", "-q", "--cached", "side.md")
    (repo / "side.md").write_text(f"{GMAIL}\n{at('more', 'hotmail.com')}\n")
    git(repo, "add", "side.md")
    git(repo, "commit", "-q", "--amend", "--no-edit", "--no-verify")
    evil = check(repo, "commits", "HEAD", "--not", "HEAD^1", "HEAD^2")

    assert clean.returncode == 0, clean.stdout
    assert evil.returncode == 1
    assert "side.md:2:" in evil.stdout
    assert "side.md:1:" not in evil.stdout


def test_a_bad_revision_is_an_error_not_a_pass(repo):
    result = check(repo, "commits", "HEAD", "--not", "origin/nowhere")

    assert result.returncode == 2


# --- The hooks and the setup step --------------------------------------------------------------


@pytest.fixture
def hooked(tmp_path):
    """A clone of a repository with the committed hooks and checker, set up by treehouse-setup.sh,
    and a bare remote it pushes to."""
    origin = make_repo(tmp_path / "origin-src")
    for path in (".githooks", "scripts/real_data_check.py", "scripts/treehouse-setup.sh"):
        source = REPO / path
        target = origin / path
        target.parent.mkdir(parents=True, exist_ok=True)
        if source.is_dir():
            shutil.copytree(source, target)
        else:
            shutil.copy2(source, target)
    git(origin, "add", ".")
    git(origin, "commit", "-q", "-m", "chore: hooks")
    remote = tmp_path / "remote.git"
    git(tmp_path, "clone", "-q", "--bare", str(origin), str(remote))
    clone = tmp_path / "clone"
    git(tmp_path, "clone", "-q", str(remote), str(clone))
    git(clone, "config", "user.name", "Test")
    git(clone, "config", "user.email", "test@example.com")
    git(clone, "config", "commit.gpgsign", "false")
    (clone / "front-end" / "node_modules").mkdir(parents=True)  # so setup installs nothing
    setup = subprocess.run(
        [BASH, "scripts/treehouse-setup.sh"],
        cwd=clone,
        env={"PATH": shutil.which("git").rsplit("/", 1)[0] + ":/usr/bin:/bin", "TREEHOUSE_DIR": str(clone)},
        text=True,
        capture_output=True,
    )
    assert setup.returncode == 0, setup.stdout + setup.stderr
    return clone


def test_the_setup_step_installs_the_hooks(hooked):
    assert git(hooked, "config", "core.hooksPath").stdout.strip() == ".githooks"


def test_the_pre_commit_hook_refuses_a_real_shaped_address(hooked):
    stage(hooked, "notes.md", f"{GMAIL}\n")

    result = git(hooked, "commit", "-m", "docs: notes", check=False)

    assert result.returncode != 0
    assert "notes.md:1:" in result.stdout + result.stderr
    assert git(hooked, "log", "-1", "--format=%s").stdout.strip() == "chore: hooks"


def test_the_pre_push_hook_refuses_a_commit_made_without_hooks(hooked):
    stage(hooked, "notes.md", f"{GMAIL}\n")
    git(hooked, "commit", "-q", "--no-verify", "-m", "docs: notes")

    result = git(hooked, "push", "origin", "HEAD:refs/heads/feature", check=False)

    assert result.returncode != 0
    assert "notes.md:1:" in result.stdout + result.stderr
    assert git(hooked, "ls-remote", "origin", "refs/heads/feature").stdout == ""


def test_a_clean_commit_and_push_go_through(hooked):
    stage(hooked, "notes.md", "vendor@example.com\n")
    git(hooked, "commit", "-q", "-m", "docs: notes")

    git(hooked, "push", "-q", "origin", "HEAD:refs/heads/feature")

    assert git(hooked, "ls-remote", "origin", "refs/heads/feature").stdout != ""


def test_a_hook_in_the_git_directory_still_runs(hooked):
    marker = hooked / "ran"
    own = Path(git(hooked, "rev-parse", "--git-common-dir").stdout.strip())
    if not own.is_absolute():
        own = hooked / own
    hook = own / "hooks" / "pre-commit"
    hook.write_text(f"#!/bin/sh\ntouch {marker}\n")
    hook.chmod(0o755)
    stage(hooked, "notes.md", "fine\n")

    git(hooked, "commit", "-q", "-m", "docs: notes")

    assert marker.exists()


# --- The gate and CI ---------------------------------------------------------------------------


def ci_step(name):
    """The `run:` of the named step of the real-data job in test.yml, as Bash will run it."""
    workflow = (REPO / ".github" / "workflows" / "test.yml").read_text()
    match = re.search(rf"- name: {re.escape(name)}\n(?:\s+\w[\w-]*:.*\n)*?\s+run: (.+)\n", workflow)
    assert match, f"no step {name!r} with a one-line run in test.yml"
    return match.group(1)


@pytest.mark.parametrize("address, code", [(GMAIL, 1), ("vendor@example.com", 0)])
def test_the_ci_jobs_command_fails_a_pr_adding_a_real_shaped_address(repo, address, code):
    git(repo, "update-ref", "refs/remotes/origin/dev", "HEAD")
    head = commit(repo, "notes.md", f"{address}\n")
    git(repo, "checkout", "-q", "--detach", "origin/dev")  # CI checks out the PR's merge, not its head
    command = ci_step("No real data in the PR's commits")
    assert command.startswith("python scripts/real_data_check.py ")
    command = command.replace("python scripts/real_data_check.py", f"{sys.executable} {CHECKER}", 1)

    result = subprocess.run(
        [BASH, "-c", command],
        cwd=repo,
        env={"PATH": "/usr/bin:/bin", "BASE_REF": "dev", "HEAD_SHA": head},
        text=True,
        capture_output=True,
    )

    assert result.returncode == code, result.stdout + result.stderr
