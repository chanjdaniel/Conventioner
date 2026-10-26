"""Vercel's Git integration deploys no branch: production moves only when the Deploy workflow is started by hand."""

import json
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("project", ["front-end", "back-end"])
def test_vercel_deploys_no_branch_from_git(project):
    config = json.loads((REPO / project / "vercel.json").read_text())

    assert config["git"]["deploymentEnabled"] is False
