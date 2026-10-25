"""Conventioner reaches Vercel only when Daniel starts the Deploy workflow by hand."""

import json
import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
DEPLOY = REPO / ".github" / "workflows" / "deploy.yml"


@pytest.mark.parametrize("project", ["front-end", "back-end"])
def test_vercel_deploys_no_branch_from_git(project):
    config = json.loads((REPO / project / "vercel.json").read_text())

    assert config["git"]["deploymentEnabled"] is False


def triggers(workflow):
    block = re.search(r"^on:\n((?:[ #].*\n|\n)*)", workflow, re.MULTILINE)
    assert block, "the workflow has no `on:` block"
    return re.findall(r"^  ([a-z_]+):", block.group(1), re.MULTILINE)


def test_the_deploy_workflow_starts_only_by_hand():
    assert triggers(DEPLOY.read_text()) == ["workflow_dispatch"]


def test_triggers_reads_every_event_of_the_on_block():
    workflow = "name: x\n\non:\n  workflow_run:\n    branches: [main]\n  # by hand\n  workflow_dispatch:\n\njobs:\n  a:\n"

    assert triggers(workflow) == ["workflow_run", "workflow_dispatch"]
