"""Every place that runs the front end's npm runs the one Node that `.nvmrc` pins, and the npm it bundles."""

import json
import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
PIN = (REPO / ".nvmrc").read_text().strip()
WORKFLOWS = sorted((REPO / ".github" / "workflows").glob("*.yml"))


def setup_node_steps(workflow):
    """Each `actions/setup-node` step's text: its `uses:` line and the indented lines under it."""
    lines = workflow.read_text().splitlines()
    steps = []
    for i, line in enumerate(lines):
        if re.search(r"uses: actions/setup-node@", line):
            indent = len(line) - len(line.lstrip(" -"))
            body = [line]
            for following in lines[i + 1 :]:
                if following.strip() and len(following) - len(following.lstrip()) < indent:
                    break
                if following.lstrip().startswith("- "):
                    break
                body.append(following)
            steps.append("\n".join(body))
    return steps


def test_the_pin_is_one_exact_version():
    assert re.fullmatch(r"\d+\.\d+\.\d+", PIN)


def test_the_front_end_image_runs_the_pinned_node():
    first_from = next(line for line in (REPO / "front-end" / "Dockerfile").read_text().splitlines() if line.startswith("FROM "))

    assert first_from == f"FROM node:{PIN}-alpine"


@pytest.mark.parametrize("workflow", WORKFLOWS, ids=lambda path: path.name)
def test_ci_reads_the_pin(workflow):
    for step in setup_node_steps(workflow):
        assert "node-version-file: .nvmrc" in step
        assert "node-version:" not in step


def test_ci_sets_node_up_somewhere():
    assert any(setup_node_steps(workflow) for workflow in WORKFLOWS)


def test_package_json_names_the_pinned_major_and_an_exact_npm():
    engines = json.loads((REPO / "front-end" / "package.json").read_text())["engines"]

    # Vercel builds the front end and takes a major only: an exact version there fails its build.
    assert engines["node"] == f"{PIN.split('.')[0]}.x"
    assert re.fullmatch(r"\d+\.\d+\.\d+", engines["npm"])
