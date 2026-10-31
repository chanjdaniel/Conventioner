"""seed_fixture.sh resets a stack's database, so it seeds only a stack it was told, and never guesses.

It runs `reset_database.py` in the stack's back end before it seeds. It used to fall back to the
primary stack's defaults wherever it found no stack: from a checkout outside a treehouse slot with
no stack exported, plain `docker compose` named the project after the directory, `conventioner`,
the primary checkout's, so a gate run that seeded before exporting its own stack's ports wiped the
primary checkout's local database (2026-10-31). Now the default stack takes `--primary`, as
`stack.ts` takes `CI`.

The script is run for real, with stub `docker`, `curl` and `th-compose.sh` that log every call.
"""

import pytest
from stacks import run_seed, slot_path

EXPLICIT = {"COMPOSE_PROJECT_NAME": "nmtest-1", "TH_MONGO_PORT": "49153", "TH_BACKEND_PORT": "49154", "TH_FRONTEND_PORT": "49155"}


def outside_a_slot(tmp_path):
    """A checkout outside any treehouse slot, named as the primary checkout and the gate's clones are."""
    return tmp_path / "Conventioner"


def resets(calls):
    """The calls that ran `reset_database.py`."""
    return [call for call in calls if "reset_database.py" in call]


def test_with_no_stack_given_it_refuses_and_touches_nothing(tmp_path):
    result, calls = run_seed(outside_a_slot(tmp_path), tmp_path)

    assert result.returncode != 0
    assert calls == []
    assert "refusing to guess" in result.stderr
    for remedy in ("COMPOSE_PROJECT_NAME", "th-compose.sh ports", "--primary"):
        assert remedy in result.stderr


@pytest.mark.parametrize(
    "variables",
    [
        {"COMPOSE_PROJECT_NAME": "nmtest-1"},
        {"COMPOSE_PROJECT_NAME": "nmtest-1", "TH_BACKEND_PORT": "49154", "TH_FRONTEND_PORT": "49155"},
        {"TH_BACKEND_PORT": "49154"},
    ],
    ids=["project-only", "no-mongo-port", "port-only"],
)
def test_a_stack_named_in_part_is_refused(tmp_path, variables):
    result, calls = run_seed(outside_a_slot(tmp_path), tmp_path, **variables)

    assert result.returncode != 0
    assert calls == []
    assert "names only part of a stack" in result.stderr


@pytest.mark.parametrize(
    "variables",
    [EXPLICIT, {"COMPOSE_PROJECT_NAME": "nmtest-1"}],
    ids=["explicit", "project-only"],
)
def test_primary_with_another_stack_named_is_refused(tmp_path, variables):
    result, calls = run_seed(outside_a_slot(tmp_path), tmp_path, "--primary", **variables)

    assert result.returncode != 0
    assert calls == []
    assert "--primary" in result.stderr


def test_primary_in_a_slot_is_refused(tmp_path):
    # In a slot, plain `docker compose` names the project after the directory, `Conventioner`, so
    # --primary would reset the primary checkout's database from the slot's code.
    result, calls = run_seed(slot_path(tmp_path, 3), tmp_path, "--primary")

    assert result.returncode != 0
    assert calls == []
    assert "treehouse slot" in result.stderr


def test_an_unknown_argument_is_refused(tmp_path):
    result, calls = run_seed(outside_a_slot(tmp_path), tmp_path, "--primry")

    assert result.returncode != 0
    assert calls == []
    assert "--primry" in result.stderr


def test_the_explicit_stack_is_seeded_through_th_compose(tmp_path):
    result, calls = run_seed(outside_a_slot(tmp_path), tmp_path, **EXPLICIT)

    assert "Could not extract user ID" in result.stdout, result.stdout + result.stderr
    assert resets(calls) == ["th-compose.sh exec -T backend python /app/reset_database.py"]
    assert "curl -k -s -o /dev/null -w %{http_code} https://127.0.0.1:49154/" in calls


def test_a_slot_s_stack_is_seeded_through_th_compose(tmp_path):
    result, calls = run_seed(slot_path(tmp_path, 3), tmp_path)

    assert "Could not extract user ID" in result.stdout, result.stdout + result.stderr
    assert resets(calls) == ["th-compose.sh exec -T backend python /app/reset_database.py"]
    assert "curl -k -s -o /dev/null -w %{http_code} https://127.0.0.1:5031/" in calls


def test_primary_seeds_the_default_stack(tmp_path):
    result, calls = run_seed(outside_a_slot(tmp_path), tmp_path, "--primary")

    assert "Could not extract user ID" in result.stdout, result.stdout + result.stderr
    assert resets(calls) == ["docker compose exec -T backend python /app/reset_database.py"]
    assert "curl -k -s -o /dev/null -w %{http_code} https://127.0.0.1:5001/" in calls
