"""The migration that folds every stored organization into its map of people (T283, ADR 0025)
folds each shape a stored organization takes with the owner winning, keeps its lists an exact
mirror, leaves one with no owner and one that changed during the run as they are, writes nothing
on a dry run, and changes nothing twice."""
from types import SimpleNamespace

import pytest

from conftest import FakeOrganizations
from migrate_organization_people import migrate
from test_an_organizations_people_stay_one_map import assert_one_map

#: Each shape a stored organization takes, and the map it folds to, in the map's order.
SHAPES = {
    "owner in admins": (
        {"owner": "u-own", "admins": ["u-a", "u-own"], "members": ["u-m"]},
        {"u-own": "owner", "u-a": "admin", "u-m": "member"}),
    "owner in members": (
        {"owner": "u-own", "admins": ["u-a"], "members": ["u-own", "u-m"]},
        {"u-own": "owner", "u-a": "admin", "u-m": "member"}),
    "an admin also a member": (
        {"owner": "u-own", "admins": ["u-a"], "members": ["u-m", "u-a"]},
        {"u-own": "owner", "u-a": "admin", "u-m": "member"}),
    "an admin listed twice": (
        {"owner": "u-own", "admins": ["u-a", "u-a"], "members": []},
        {"u-own": "owner", "u-a": "admin"}),
    "empty lists": (
        {"owner": "u-own", "admins": [], "members": []},
        {"u-own": "owner"}),
    "missing lists": (
        {"owner": "u-own"},
        {"u-own": "owner"}),
    "a list that is not one": (
        {"owner": "u-own", "admins": "u-a", "members": ["u-m"]},
        {"u-own": "owner", "u-m": "member"}),
}


def _org(org_id, **lists):
    return {"id": org_id, "name": f"Fixture {org_id}", "markets": [], "theme": None, **lists}


def _db(*docs):
    return SimpleNamespace(organizations=FakeOrganizations(*docs))


def _stored(db, org_id):
    return next(doc for doc in db.organizations.docs if doc["id"] == org_id)


@pytest.mark.parametrize("shape", SHAPES)
def test_each_shape_folds_into_its_map_with_the_lists_its_mirror(shape):
    lists, people = SHAPES[shape]
    db = _db(_org("org-1", **lists))

    counts = migrate(db)

    stored = _stored(db, "org-1")
    assert list(stored["people"].items()) == list(people.items())
    assert stored["owner"] == "u-own"
    assert stored["admins"] == [u for u, place in people.items() if place == "admin"]
    assert stored["members"] == [u for u, place in people.items() if place == "member"]
    assert_one_map(stored)
    assert counts["folded"] == 1


def test_the_write_holds_what_it_read():
    lists, _ = SHAPES["owner in admins"]
    db = _db(_org("org-1", **lists))

    migrate(db)

    [(query, _update)] = db.organizations.writes
    assert query == {"id": "org-1", "people": {"$exists": False}, "owner": "u-own",
                     "admins": ["u-a", "u-own"], "members": ["u-m"]}


def test_an_organization_with_no_owner_is_left_as_it_is_and_listed(capsys):
    db = _db(_org("org-none", owner="", admins=["u-a"], members=[]),
             _org("org-missing", admins=["u-a"]))

    counts = migrate(db)

    assert db.organizations.writes == []
    assert all("people" not in doc for doc in db.organizations.docs)
    out = capsys.readouterr().out
    assert "org-none 'Fixture org-none': has no owner; left as it is" in out
    assert "org-missing 'Fixture org-missing': has no owner; left as it is" in out
    assert counts["no_owner"] == 2 and counts["folded"] == 0


def test_an_organization_holding_an_id_that_cannot_be_a_key_is_left_as_it_is(capsys):
    db = _db(_org("org-dotted", owner="u-own", admins=["admin@example.com"]),
             _org("org-ok", owner="u-own"))

    counts = migrate(db)

    assert "people" not in _stored(db, "org-dotted")
    assert "people" in _stored(db, "org-ok")
    assert "org-dotted 'Fixture org-dotted': holds an id that cannot be a key" in capsys.readouterr().out
    assert counts["not_a_key"] == 1 and counts["folded"] == 1


def test_a_folded_organization_is_counted_and_never_written():
    folded = _org("org-folded", owner="u-own", admins=[], members=["u-m"],
                  people={"u-own": "owner", "u-m": "member"})
    db = _db(dict(folded))

    counts = migrate(db)

    assert db.organizations.writes == []
    assert _stored(db, "org-folded") == folded
    assert counts["already_folded"] == 1 and counts["folded"] == 0


def _every_shape():
    return [_org(f"org-{i}", **lists) for i, (lists, _people) in enumerate(SHAPES.values())]


def test_the_dry_run_writes_nothing_and_prints_each_organization_and_the_counts(capsys):
    db = _db(*_every_shape(), _org("org-none", owner="", admins=["u-a"]),
             _org("org-folded", owner="u-own", people={"u-own": "owner"}))

    counts = migrate(db, dry_run=True)

    assert db.organizations.writes == []
    assert all("people" not in doc for doc in db.organizations.docs if doc["id"] != "org-folded")
    out = capsys.readouterr().out
    assert ("  - org-0 'Fixture org-0': one owner, 1 admin(s), 1 member(s) (does not parse today)"
            in out)
    assert ("  - org-1 'Fixture org-1': one owner, 1 admin(s), 1 member(s) (does not parse today)"
            in out)
    assert ("  - org-2 'Fixture org-2': one owner, 1 admin(s), 1 member(s) "
            "(an admin also listed as a member)" in out)
    assert "  - org-4 'Fixture org-4': one owner, 0 admin(s), 0 member(s)\n" in out
    assert "Would fold 7 organization(s) into their map of people; 1 already folded." in out
    assert ("Of those to fold, 2 do not parse today (an owner also an admin or a member) "
            "and 1 list an admin also as a member.") in out
    assert ("Skipped 1: 1 with no owner, 0 holding an id that cannot be a key, "
            "0 changed during the run.") in out
    assert counts == {"folded": 7, "already_folded": 1, "does_not_parse": 2,
                      "admin_also_member": 1, "no_owner": 1, "not_a_key": 0, "changed": 0,
                      "rebuilt": 0}


def test_a_dry_run_then_the_run_count_alike():
    dry = migrate(_db(*_every_shape()), dry_run=True)
    run = migrate(_db(*_every_shape()))

    assert dry == run


def test_a_second_run_changes_nothing(capsys):
    db = _db(*_every_shape())
    migrate(db)
    after_first = [dict(doc) for doc in db.organizations.docs]
    written = len(db.organizations.writes)
    capsys.readouterr()

    counts = migrate(db)

    assert len(db.organizations.writes) == written
    assert db.organizations.docs == after_first
    assert counts["folded"] == 0 and counts["already_folded"] == len(SHAPES)
    assert "Nothing to fold: the migration has already run." in capsys.readouterr().out


def test_an_organization_changed_between_read_and_write_is_left_alone(capsys):
    lists, _ = SHAPES["owner in admins"]
    db = _db(_org("org-1", **lists), _org("org-2", owner="u-own"))

    def an_admin_added_meanwhile():
        _stored(db, "org-1")["admins"].append("u-new")

    db.organizations.before_write = an_admin_added_meanwhile

    counts = migrate(db)

    changed = _stored(db, "org-1")
    assert "people" not in changed
    assert changed["admins"] == ["u-a", "u-own", "u-new"]
    assert "people" in _stored(db, "org-2")
    assert "org-1 'Fixture org-1': changed during the run; run again" in capsys.readouterr().out
    assert counts["changed"] == 1 and counts["folded"] == 1

    again = migrate(db)

    assert list(_stored(db, "org-1")["people"].items()) == [
        ("u-own", "owner"), ("u-a", "admin"), ("u-new", "admin"), ("u-m", "member")]
    assert again["folded"] == 1 and again["changed"] == 0
