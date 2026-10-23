"""The knowledge-graph checker, driven the way CI drives it: a small git repository, the CLI, its output."""

import datetime
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import knowledge_graph  # noqa: E402


def git(repo, *args, date=None):
    env = {**os.environ, "GIT_COMMITTER_DATE": date} if date else None
    return subprocess.run(
        ["git", *args], cwd=repo, capture_output=True, text=True, check=True, env=env
    ).stdout.strip()


@pytest.fixture
def repo(tmp_path, monkeypatch):
    git(tmp_path, "init", "-q", "-b", "dev")
    git(tmp_path, "config", "user.email", "test@example.com")
    git(tmp_path, "config", "user.name", "Test")
    git(tmp_path, "config", "commit.gpgsign", "false")
    monkeypatch.chdir(tmp_path)
    return tmp_path


def write(repo, files):
    for name, text in files.items():
        path = repo / name
        if text is None:
            path.unlink()
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")


def commit(repo, files, message="change", date="2026-10-10T12:00:00+08:00"):
    write(repo, files)
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", message, f"--date={date}", date=date)
    return git(repo, "rev-parse", "HEAD")


def run(capsys, *argv):
    code = knowledge_graph.main(list(argv))
    out = capsys.readouterr().out
    return code, out


def errors(capsys, *argv):
    code, out = run(capsys, *argv)
    return code, [line for line in out.splitlines() if ": " in line and line.split(":", 2)[1].isdigit()]


def node(layer, kind, body, describes=None, verified="2026-10-01", sources=None, status=None):
    lines = ["---", f"layer: {layer}", f"kind: {kind}"]
    if describes is not None:
        lines.append("describes:")
        lines += [f"  - {d}" for d in describes]
    if verified is not None:
        lines.append(f"verified: {verified}")
    if sources is not None:
        lines.append("sources:")
        lines += [f"  - {s}" for s in sources]
    if status is not None:
        lines.append(f"status: {status}")
    lines.append("---")
    return "\n".join(lines) + "\n" + body


GUARDS_PY = '''\
import os


LIMIT = 3


def judge(market):
    return market


@decorated
def blocked(market):
    """A refused move."""
    return None


class Guard:
    def evaluate(self, market):
        return True
'''


def graph():
    """A whole, passing graph: two hubs, a business rule and the module that keeps it."""
    return {
        "README.md": "# Project\n\nStart with [the docs](docs/README.md).\n",
        "AGENTS.md": "# Agents\n\nRead [the docs](docs/README.md).\n",
        "back-end/guards.py": GUARDS_PY,
        "docs/README.md": (
            "# The graph\n\n"
            "- [Rules](business/rules/README.md)\n"
            "- [Modules](implementation/modules/README.md)\n"
        ),
        "docs/business/rules/README.md": "# Rules\n\n- [Moves are judged](moves-are-judged.md) - one line\n",
        "docs/implementation/modules/README.md": "# Modules\n\n- [Guards](guards.md) - one line\n",
        "docs/business/rules/moves-are-judged.md": node(
            "business",
            "rule",
            "# Moves are judged\n\nEvery move is judged first.\n\n"
            "## Where it is kept\n\n[Guards](../../implementation/modules/guards.md#why)\n",
            sources=["E31/F01", "wayfinding/the-order-of-the-work/03"],
        ),
        "docs/implementation/modules/guards.md": node(
            "implementation",
            "module",
            "# Guards\n\nThe guards live in [guards.py](../../../back-end/guards.py).\n\n"
            "## Why\n\nThey keep [moves are judged](../../business/rules/moves-are-judged.md).\n",
            describes=["back-end/guards.py#judge"],
        ),
    }


# check: the whole graph


def test_a_whole_graph_passes(repo, capsys):
    commit(repo, graph())
    code, out = run(capsys, "check")
    assert code == 0, out


def test_a_repository_with_no_graph_yet_passes(repo, capsys):
    commit(repo, {"README.md": "# Project\n\nSee [startup](docs/STARTUP.md).\n", "docs/STARTUP.md": "# Startup\n"})
    assert run(capsys, "check")[0] == 0


def test_errors_are_path_line_message_sorted(repo, capsys):
    files = graph()
    files["README.md"] += "\n[gone](docs/gone.md)\n"
    files["AGENTS.md"] += "\n[gone](nowhere.md)\n"
    commit(repo, files)
    code, lines = errors(capsys, "check")
    assert code == 1
    assert lines == [
        "AGENTS.md:5: broken link: nowhere.md",
        "README.md:5: broken link: docs/gone.md",
    ]


def test_it_runs_from_a_subdirectory(repo, capsys, monkeypatch):
    commit(repo, graph())
    monkeypatch.chdir(repo / "docs")
    assert run(capsys, "check")[0] == 0


# check: the frontmatter schema


def rule_with(**overrides):
    files = graph()
    files["docs/business/rules/moves-are-judged.md"] = overrides.pop("text")
    return files


RULE_BODY = (
    "# Moves are judged\n\n"
    "[Guards](../../implementation/modules/guards.md)\n"
)


@pytest.mark.parametrize(
    "frontmatter, message",
    [
        ("layer: business\nkind: policy\nverified: 2026-10-01", "3: unknown kind: policy"),
        ("layer: implementation\nkind: rule\nverified: 2026-10-01", "2: a rule is in the business layer, not implementation"),
        ("layer: business\nkind: rule", "1: a rule requires verified"),
        ("kind: rule\nverified: 2026-10-01", "1: missing required key: layer"),
        ("layer: business\nkind: rule\nverified: 2026-10-01\nstatus: accepted", "5: a rule has no status"),
        ("layer: business\nkind: rule\nverified: 2026-10-01\nowner: daniel", "5: unknown frontmatter key: owner"),
        ("layer: business\nkind: rule\nverified: 2026-02-30", "4: verified is a real date, YYYY-MM-DD: 2026-02-30"),
        ("layer: business\nkind: rule\nverified: 2999-01-01", "4: verified is in the future: 2999-01-01"),
        ("kind: rule\nlayer: business\nverified: 2026-10-01", "1: frontmatter keys out of order"),
        ("layer: business\nkind: rule\nverified: 2026-10-01\nsources:\n  - E31/F01/S01\n  - wayfinding/v0-1-0/map\n"
         "  - brain-dump/2026-10-19#4\n  - qc/2026-09-21\n  - bug/39\n  - known-gap/1\n  - T15\n  - decision/2026-10-20\n"
         "  - .scratch/backlog/E31.md",
         "14: not a source string: .scratch/backlog/E31.md"),
        ("layer: business\nkind: rule\nverified: 2026-10-01\nsources: [E31, story 4]", "5: not a source string: story 4"),
    ],
)
def test_the_schema_names_each_failure(repo, capsys, frontmatter, message):
    commit(repo, rule_with(text=f"---\n{frontmatter}\n---\n{RULE_BODY}"))
    code, lines = errors(capsys, "check")
    assert code == 1
    assert any(line.startswith("docs/business/rules/moves-are-judged.md:" + message) for line in lines), lines


@pytest.fixture
def furthest_west(monkeypatch):
    monkeypatch.setenv("TZ", "Etc/GMT+12")
    time.tzset()
    yield
    monkeypatch.undo()
    time.tzset()


def test_a_day_already_begun_somewhere_is_not_in_the_future(repo, capsys, furthest_west):
    east = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=14))).date()
    assert east > datetime.date.today()
    commit(repo, rule_with(text=f"---\nlayer: business\nkind: rule\nverified: {east}\n---\n{RULE_BODY}"))
    code, lines = errors(capsys, "check")
    assert (code, lines) == (0, [])


def test_a_record_carries_no_verified_and_an_adr_a_status(repo, capsys):
    files = graph()
    files["docs/README.md"] += "- [ADRs](adr/README.md)\n- [Records](records/README.md)\n"
    files["docs/adr/README.md"] = "# ADRs\n\n- [One](0001-one.md)\n"
    files["docs/records/README.md"] = "# Records\n\n- [Bugs](MVP_BUGS.md)\n"
    files["docs/adr/0001-one.md"] = node("implementation", "adr", "# One\n")
    files["docs/records/MVP_BUGS.md"] = node("implementation", "record", "# Bugs\n")
    commit(repo, files)
    code, lines = errors(capsys, "check")
    assert code == 1
    assert lines == [
        "docs/adr/0001-one.md:1: a adr requires status",
        "docs/records/MVP_BUGS.md:4: a record has no verified",
    ]


def test_describes_must_exist_and_be_linked(repo, capsys):
    files = graph()
    files["docs/implementation/modules/guards.md"] = node(
        "implementation",
        "module",
        "# Guards\n\n[guards.py](../../../back-end/guards.py)\n\n"
        "## Why\n\n[moves are judged](../../business/rules/moves-are-judged.md)\n",
        describes=[
            "back-end/guards.py#judge",
            "back-end/guards.py#Guard.evaluate",
            "back-end/guards.py#LIMIT",
            "back-end/guards.py#vanished",
            "back-end/gone.py",
            "back-end",
            "back-end/missing/",
            "README.md",
        ],
    )
    commit(repo, files)
    code, lines = errors(capsys, "check")
    assert code == 1
    assert lines == [
        "docs/implementation/modules/guards.md:8: describes a symbol not found: back-end/guards.py#vanished",
        "docs/implementation/modules/guards.md:9: describes a file that is not tracked: back-end/gone.py",
        "docs/implementation/modules/guards.md:10: a described directory ends in /: back-end",
        "docs/implementation/modules/guards.md:11: describes a directory that is not tracked: back-end/missing/",
        "docs/implementation/modules/guards.md:12: the body never links described file: README.md",
    ]


def test_a_module_describes_something(repo, capsys):
    files = graph()
    files["docs/implementation/modules/guards.md"] = node(
        "implementation", "module", "# Guards\n\n## Why\n\n[rule](../../business/rules/moves-are-judged.md)\n"
    )
    commit(repo, files)
    code, lines = errors(capsys, "check")
    assert lines == ["docs/implementation/modules/guards.md:1: a module requires describes"]


def test_typescript_and_vue_symbols_are_found(repo, capsys):
    files = graph()
    files["front-end/src/stores/market.ts"] = (
        "import { x } from 'y';\n\nexport const useMarketStore = defineStore();\n\n"
        "export async function refresh() {\n  return 1;\n}\n\ninterface Held {\n  id: string;\n}\n"
    )
    files["front-end/src/Rail.vue"] = "<script setup lang=\"ts\">\nconst phases = [];\nfunction move() {}\n</script>\n"
    files["docs/implementation/modules/guards.md"] = node(
        "implementation",
        "module",
        "# Guards\n\n[store](../../../front-end/src/stores/market.ts) [rail](../../../front-end/src/Rail.vue)\n"
        "## Why\n\n[rule](../../business/rules/moves-are-judged.md)\n",
        describes=[
            "front-end/src/stores/market.ts#useMarketStore",
            "front-end/src/stores/market.ts#refresh",
            "front-end/src/stores/market.ts#Held",
            "front-end/src/Rail.vue#move",
            "front-end/src/stores/market.ts#x",
        ],
    )
    commit(repo, files)
    code, lines = errors(capsys, "check")
    assert lines == [
        "docs/implementation/modules/guards.md:9: describes a symbol not found: front-end/src/stores/market.ts#x"
    ]


def test_a_hub_must_not_carry_frontmatter(repo, capsys):
    files = graph()
    files["docs/README.md"] = "---\nlayer: business\n---\n" + files["docs/README.md"]
    commit(repo, files)
    code, lines = errors(capsys, "check")
    assert lines == ["docs/README.md:1: a hub must not carry frontmatter"]


# check: links and fragments


def test_fragments_follow_github_slugs_duplicates_and_explicit_anchors(repo, capsys):
    files = graph()
    files["docs/OPS.md"] = (
        "# Operations\n\n## Pre-deploy: required *production* environment\n\n"
        "## Steps\n\n## Steps\n\n#### `schema_migrations` Collection\n\n"
        "### 4. The review card puts the applicant's name last\n\n"
        '<a id="bug-39"></a>\n\n```\n# Not a heading\n```\n'
    )
    files["README.md"] += (
        "\n[a](docs/OPS.md#pre-deploy-required-production-environment)\n"
        "[b](docs/OPS.md#steps-1)\n"
        "[c](docs/OPS.md#schema_migrations-collection)\n"
        "[d](docs/OPS.md#4-the-review-card-puts-the-applicants-name-last)\n"
        "[e](docs/OPS.md#bug-39)\n"
        "[f](#project)\n"
        "[g](docs/OPS.md#steps-2)\n"
        "[h](docs/OPS.md#not-a-heading)\n"
        "[i](#nowhere)\n"
        "[j](back-end/guards.py#L3)\n"
    )
    commit(repo, files)
    code, lines = errors(capsys, "check")
    assert lines == [
        "README.md:11: broken fragment: docs/OPS.md#steps-2",
        "README.md:12: broken fragment: docs/OPS.md#not-a-heading",
        "README.md:13: broken fragment: #nowhere",
    ]


def test_links_in_code_are_not_links(repo, capsys):
    files = graph()
    files["README.md"] += (
        "\n```markdown\n[gone](gone.md)\n```\n\n"
        "~~~\n[gone](gone.md)\n~~~\n\n"
        "Write `[gone](gone.md)` like this, or ``[gone](gone.md)``.\n"
    )
    commit(repo, files)
    assert run(capsys, "check")[0] == 0


def test_images_reference_definitions_and_external_links(repo, capsys):
    files = graph()
    files["README.md"] += (
        "\n![logo](docs/logo.png) [![badge](docs/badge.svg)](https://ci.example.com)\n"
        "[site](https://example.com/x.md) <https://example.com> [mail](mailto:a@b.c)\n\n"
        "[ref]: docs/missing.md\n"
    )
    commit(repo, {**files, "docs/logo.png": "png"})
    code, lines = errors(capsys, "check")
    assert lines == [
        "README.md:5: broken link: docs/badge.svg",
        "README.md:8: broken link: docs/missing.md",
    ]


def test_a_link_to_a_directory_or_from_the_root_resolves(repo, capsys):
    files = graph()
    files["README.md"] += "\n[code](back-end/) [code](/back-end) [up](../outside.md)\n"
    commit(repo, files)
    code, lines = errors(capsys, "check")
    assert lines == ["README.md:5: broken link: ../outside.md"]


def test_graph_files_never_link_into_scratch_and_others_may(repo, capsys):
    files = graph()
    files[".scratch/backlog/E31.md"] = "# E31\n"
    files["docs/MVP_KNOWN_GAPS.md"] = "# Gaps\n\n[epic](../.scratch/backlog/E31.md)\n"
    files["README.md"] += "\n[gaps](docs/MVP_KNOWN_GAPS.md)\n"
    files["docs/README.md"] += "\n[epic](../.scratch/backlog/E31.md)\n"
    commit(repo, files)
    code, lines = errors(capsys, "check")
    assert lines == ["docs/README.md:6: a graph file never links into .scratch/: ../.scratch/backlog/E31.md"]


def test_scratch_symlinks_and_the_changelog_are_not_checked(repo, capsys):
    files = graph()
    files[".scratch/notes.md"] = "[gone](gone.md)\n"
    files["CHANGELOG.md"] = "[gone](gone.md)\n"
    commit(repo, files)
    (repo / "CLAUDE.md").symlink_to("AGENTS.md")
    commit(repo, {})
    assert run(capsys, "check")[0] == 0


# check: folders, reachability, back-links


def test_a_node_sits_in_the_folder_of_its_kind_under_a_kebab_name(repo, capsys):
    files = graph()
    files["docs/business/rules/README.md"] += "- [Flow](a-flow.md)\n- [Odd](Odd_Name.md)\n"
    files["docs/business/rules/a-flow.md"] = node("business", "flow", "# A flow\n")
    files["docs/business/rules/Odd_Name.md"] = node("business", "rule", "# Odd\n")
    files["docs/business/stray.md"] = node("business", "rule", "# Stray\n")
    files["docs/README.md"] += "- [Stray](business/stray.md)\n"
    commit(repo, files)
    code, lines = errors(capsys, "check")
    assert lines == [
        "docs/business/rules/Odd_Name.md:1: a node's file name is kebab-case",
        "docs/business/rules/a-flow.md:1: docs/business/rules/ holds only nodes of kind rule",
        "docs/business/stray.md:1: a file under docs/business/ or docs/implementation/ belongs in a kind folder",
    ]


def test_a_graph_folder_has_its_readme(repo, capsys):
    files = graph()
    del files["docs/implementation/modules/README.md"]
    files["docs/README.md"] = files["docs/README.md"].replace(
        "implementation/modules/README.md", "implementation/modules/guards.md"
    )
    commit(repo, files)
    code, lines = errors(capsys, "check")
    assert lines == ["docs/implementation/modules/README.md:1: a graph folder has a README.md hub"]


def test_before_the_graph_has_an_entry_folders_and_hubs_wait(repo, capsys):
    commit(repo, {"README.md": "# Project\n", "CONTEXT.md": "# Terms\n", "docs/adr/0001-one.md": "# One\n"})
    assert run(capsys, "check")[0] == 0


def test_every_node_and_hub_is_reachable(repo, capsys):
    files = graph()
    files["CONTEXT.md"] = "# Terms\n"
    files["docs/business/rules/lonely.md"] = node(
        "business", "rule", "# Lonely\n\n[pair](paired.md)\n"
    )
    files["docs/business/rules/paired.md"] = node("business", "rule", "# Paired\n\n[lonely](lonely.md)\n")
    commit(repo, files)
    code, lines = errors(capsys, "check")
    assert lines == [
        "CONTEXT.md:1: not reachable from README.md or AGENTS.md",
        "docs/business/rules/lonely.md:1: not reachable from README.md or AGENTS.md",
        "docs/business/rules/paired.md:1: not reachable from README.md or AGENTS.md",
    ]


def test_a_cross_layer_link_is_answered(repo, capsys):
    files = graph()
    files["docs/implementation/modules/guards.md"] = files["docs/implementation/modules/guards.md"].replace(
        "They keep [moves are judged](../../business/rules/moves-are-judged.md).\n", ""
    )
    commit(repo, files)
    code, lines = errors(capsys, "check")
    assert lines == [
        "docs/business/rules/moves-are-judged.md:15: docs/implementation/modules/guards.md "
        "does not link back to this business node"
    ]


def test_a_link_within_a_layer_may_be_one_way(repo, capsys):
    files = graph()
    files["docs/business/rules/README.md"] += "- [Other](other.md)\n"
    files["docs/business/rules/other.md"] = node("business", "rule", "# Other\n\n[judged](moves-are-judged.md)\n")
    commit(repo, files)
    assert run(capsys, "check")[0] == 0


# drift


def drift_graph(describes):
    files = graph()
    files["front-end/src/stores/market.ts"] = (
        "export const useMarketStore = defineStore();\n\n"
        "export async function refresh() {\n  return 1;\n}\n\nexport function clear() {\n  return 0;\n}\n"
    )
    links = "".join(f"[f](../../../{d.partition('#')[0]})\n" for d in describes)
    files["docs/implementation/modules/guards.md"] = node(
        "implementation",
        "module",
        "# Guards\n\n" + links + "\n## Why\n\n[rule](../../business/rules/moves-are-judged.md)\n",
        describes=describes,
    )
    return files


def drifted(repo, capsys, describes, change, *argv):
    commit(repo, drift_graph(describes), "base")
    git(repo, "checkout", "-q", "-b", "feature")
    commit(repo, change)
    return errors(capsys, "drift", "--base", "dev", *argv)


def test_drift_warns_on_a_whole_file_and_names_the_line_to_bump(repo, capsys):
    code, lines = drifted(
        repo, capsys, ["back-end/guards.py"], {"back-end/guards.py": GUARDS_PY + "\nNEW = 1\n"}
    )
    assert code == 1
    assert lines == [
        "docs/implementation/modules/guards.md:6: back-end/guards.py changed, and this node describes "
        'back-end/guards.py; re-read it and bump "verified: 2026-10-01"'
    ]


def test_drift_warns_on_a_directory(repo, capsys):
    code, lines = drifted(repo, capsys, ["back-end/"], {"back-end/new.py": "x = 1\n"})
    assert code == 1
    assert [line.split(": ", 1)[1].split(",")[0] for line in lines] == ["back-end/new.py changed"]


def test_drift_is_quiet_when_the_node_is_touched_too(repo, capsys):
    files = drift_graph(["back-end/guards.py"])
    code, lines = drifted(
        repo,
        capsys,
        ["back-end/guards.py"],
        {
            "back-end/guards.py": GUARDS_PY + "\nNEW = 1\n",
            "docs/implementation/modules/guards.md": files["docs/implementation/modules/guards.md"].replace(
                "2026-10-01", "2026-10-02"
            ),
        },
    )
    assert (code, lines) == (0, [])


def test_drift_is_quiet_when_nothing_described_changed(repo, capsys):
    code, lines = drifted(repo, capsys, ["back-end/guards.py"], {"README.md": "# Project\n\n[docs](docs/README.md)\n"})
    assert (code, lines) == (0, [])


def at_noon(file, day):
    return file, f"{day}T12:00:00+08:00"


@pytest.mark.parametrize(
    "verified, changes, warns",
    [
        ("2026-10-05", [at_noon("back-end/guards.py", "2026-10-06")], True),
        ("2026-10-06", [at_noon("back-end/guards.py", "2026-10-06")], False),
        ("2026-10-07", [at_noon("back-end/guards.py", "2026-10-06")], False),
        # the newest commit to the file counts, by date rather than by order
        ("2026-10-07", [at_noon("back-end/guards.py", "2026-10-06"), at_noon("back-end/guards.py", "2026-10-08")], True),
        ("2026-10-07", [at_noon("back-end/guards.py", "2026-10-08"), at_noon("back-end/guards.py", "2026-10-06")], True),
        ("2026-10-08", [at_noon("back-end/guards.py", "2026-10-06"), at_noon("back-end/guards.py", "2026-10-08")], False),
        # a later commit that leaves the described file alone does not count
        ("2026-10-06", [at_noon("back-end/guards.py", "2026-10-06"), at_noon("README.md", "2026-10-08")], False),
        # the day is the committer's own, as `verified` is: not UTC's
        ("2026-10-06", [("back-end/guards.py", "2026-10-06T07:00:00+08:00")], False),
        ("2026-10-05", [("back-end/guards.py", "2026-10-05T20:00:00-07:00")], False),
    ],
)
def test_drift_passes_a_node_verified_on_or_after_the_day_of_its_newest_change(
    repo, capsys, verified, changes, warns
):
    files = drift_graph(["back-end/guards.py"])
    files["docs/implementation/modules/guards.md"] = files["docs/implementation/modules/guards.md"].replace(
        "2026-10-01", verified
    )
    commit(repo, files, "base", date="2026-10-01T12:00:00+08:00")
    git(repo, "checkout", "-q", "-b", "feature")
    for n, (file, date) in enumerate(changes):
        commit(repo, {file: files[file] + f"\n# change {n}\n" * (n + 1)}, date=date)
    code, lines = errors(capsys, "drift", "--base", "dev")
    assert (code, len(lines)) == ((1, 1) if warns else (0, 0)), lines


def test_drift_dates_a_change_by_its_own_commit_not_the_merge_that_carries_it(repo, capsys):
    # CI checks out the pull request merged into its base, a merge commit made the day CI runs
    files = drift_graph(["back-end/guards.py"])
    files["docs/implementation/modules/guards.md"] = files["docs/implementation/modules/guards.md"].replace(
        "2026-10-01", "2026-10-06"
    )
    commit(repo, files, "base", date="2026-10-01T12:00:00+08:00")
    git(repo, "checkout", "-q", "-b", "feature")
    commit(repo, {"back-end/guards.py": "NEW = 1\n" + files["back-end/guards.py"]}, date="2026-10-06T12:00:00+08:00")
    git(repo, "checkout", "-q", "dev")
    commit(repo, {"back-end/guards.py": files["back-end/guards.py"] + "\nOTHER = 1\n"}, "dev", "2026-10-07T12:00:00+08:00")
    git(repo, "merge", "-q", "--no-ff", "--no-commit", "feature")
    git(repo, "commit", "-q", "-m", "merge", "--date=2026-10-09T12:00:00+08:00", date="2026-10-09T12:00:00+08:00")
    code, lines = errors(capsys, "drift", "--base", "HEAD^1", "--head", "HEAD")
    assert (code, lines) == (0, [])


def test_drift_dates_a_rebased_change_by_the_day_it_reached_the_base(repo, capsys):
    # a rebase keeps the author date, so a change written before the node was re-read on dev must
    # still warn once it lands on top of that re-read
    files = drift_graph(["back-end/guards.py"])
    commit(repo, files, "base", date="2026-10-01T12:00:00+08:00")
    git(repo, "checkout", "-q", "-b", "feature")
    commit(repo, {"back-end/guards.py": files["back-end/guards.py"] + "\nNEW = 1\n"}, date="2026-10-05T12:00:00+08:00")
    git(repo, "checkout", "-q", "dev")
    reread = files["docs/implementation/modules/guards.md"].replace("2026-10-01", "2026-10-08")
    commit(repo, {"docs/implementation/modules/guards.md": reread}, "re-read", "2026-10-08T12:00:00+08:00")
    git(repo, "checkout", "-q", "feature")
    git(repo, "rebase", "-q", "dev", date="2026-10-10T12:00:00+08:00")
    assert git(repo, "log", "-1", "--format=%as %cs") == "2026-10-05 2026-10-10"
    code, lines = errors(capsys, "drift", "--base", "dev")
    assert (code, len(lines)) == (1, 1), lines


@pytest.mark.parametrize(
    "entry, edit, warns",
    [
        ("back-end/guards.py#judge", ("    return market\n", "    return None\n"), True),
        ("back-end/guards.py#blocked", ("    return market\n", "    return None\n"), False),
        ("back-end/guards.py#blocked", ("@decorated\n", "@other\n"), True),
        ("back-end/guards.py#Guard.evaluate", ("        return True\n", "        return False\n"), True),
        ("back-end/guards.py#Guard.evaluate", ("LIMIT = 3\n", "LIMIT = 4\n"), False),
        ("back-end/guards.py#LIMIT", ("LIMIT = 3\n", "LIMIT = 4\n"), True),
        ("back-end/guards.py#blocked", ('    """A refused move."""\n', ""), True),
        ("front-end/src/stores/market.ts#refresh", ("  return 1;\n", "  return 2;\n"), True),
        ("front-end/src/stores/market.ts#refresh", ("  return 0;\n", "  return 3;\n"), False),
        ("front-end/src/stores/market.ts#clear", ("  return 0;\n", "  return 3;\n"), True),
    ],
)
def test_drift_narrows_a_symbol_to_its_span(repo, capsys, entry, edit, warns):
    file = entry.partition("#")[0]
    before = drift_graph([entry])[file]
    assert edit[0] in before
    code, lines = drifted(repo, capsys, [entry], {file: before.replace(edit[0], edit[1], 1)})
    assert code == (1 if warns else 0), lines
    assert len(lines) == (1 if warns else 0)


def test_drift_replays_a_merge_from_history(repo, capsys):
    commit(repo, drift_graph(["back-end/guards.py#judge"]), "base")
    git(repo, "checkout", "-q", "-b", "feature")
    commit(repo, {"back-end/guards.py": GUARDS_PY.replace("    return market\n", "    return None\n")})
    git(repo, "checkout", "-q", "dev")
    commit(repo, {"README.md": "# Project\n\nStart with [the docs](docs/README.md).\n\nMore.\n"})
    git(repo, "merge", "-q", "--no-ff", "-m", "merge", "feature")
    merge = git(repo, "rev-parse", "HEAD")
    commit(repo, {"docs/implementation/modules/guards.md": None, "back-end/guards.py": None})
    code, lines = errors(capsys, "drift", "--base", f"{merge}^1", "--head", merge)
    assert code == 0  # the node is read from the working tree, where it is gone
    commit(repo, drift_graph(["back-end/guards.py#judge"]))
    code, lines = errors(capsys, "drift", "--base", f"{merge}^1", "--head", merge)
    assert code == 1
    assert len(lines) == 1 and "back-end/guards.py changed" in lines[0]


# stale and ids


def test_stale_lists_old_nodes_whose_code_moved(repo, capsys):
    files = graph()
    files["docs/implementation/modules/guards.md"] = files["docs/implementation/modules/guards.md"].replace(
        "2026-10-01", "2020-01-01"
    )
    commit(repo, files)
    commit(repo, {"back-end/guards.py": GUARDS_PY + "\nNEW = 1\n"})
    code, out = run(capsys, "stale")
    assert code == 0
    assert "docs/implementation/modules/guards.md: verified 2020-01-01, 2 commits to its described files since" in out
    assert "moves-are-judged" not in out  # describes nothing
    assert "1 stale node " in out
    code, out = run(capsys, "stale", "--days", "100000")
    assert "0 stale nodes" in out


def test_ids_lists_uncovered_work_items_with_counts(repo, capsys):
    files = graph()
    files["back-end/guards.py"] = GUARDS_PY + "# E31/F01/S02 E31/F01/S02 E22/F03 E36\n# E05E06 HE12\n"
    files["front-end/a.ts"] = "// E22/F03 and E31/F02\n"
    files[".scratch/x.md"] = "E99\n"
    files["CHANGELOG.md"] = "E98\n"
    commit(repo, files)
    code, out = run(capsys, "ids")
    assert code == 0
    lines = out.splitlines()
    assert lines[:-1] == ["    2 E22/F03", "    1 E31/F02", "    1 E36"]
    assert "3 work-item ids" in lines[-1] and "(4 citations)" in lines[-1]
