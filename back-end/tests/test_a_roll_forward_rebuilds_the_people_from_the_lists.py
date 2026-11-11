"""After a rollback past the release that keeps an organization's people as one map, and a roll
forward over it, the migration's ``--reconcile`` rebuilds each map from the lists the release
before wrote (T283, ADR 0025).

The release before writes only ``owner``, ``admins`` and ``members``, so while it runs a folded
organization's ``people`` goes stale, and once the map's release runs again every reader prefers
the stale map: a person removed meanwhile would keep their roles, one added would have none, and an
organization handed on would read as its old owner's. Each test replays the release before's own
writes on a folded organization, as it makes them, then reads the organization as the market read
does."""
import copy
from types import SimpleNamespace

import pytest

import api.markets as MarketsApi
import api.users as UsersApi
import history as History
import organization_people as OrganizationPeople
from conftest import FakeOrganizations, install_organizations
from migrate_organization_people import migrate
from test_an_organizations_people_stay_one_map import assert_one_map

OWNER, ADMIN, MEMBER, NEW = "u-own", "u-admin", "u-member", "u-new"


def _folded(org_id="org-1", people=None):
    """An organization as the map's release leaves it: its map, and the lists its exact mirror."""
    people = people or {OWNER: "owner", ADMIN: "admin", MEMBER: "member"}
    return {"id": org_id, "name": f"Fixture {org_id}", "markets": [], "theme": None,
            "people": dict(people),
            "owner": next(u for u, place in people.items() if place == "owner"),
            "admins": [u for u, place in people.items() if place == "admin"],
            "members": [u for u, place in people.items() if place == "member"]}


def _db(*docs):
    return SimpleNamespace(organizations=FakeOrganizations(*docs))


def _stored(db, org_id="org-1"):
    return next(doc for doc in db.organizations.docs if doc["id"] == org_id)


def _read(db, org_id="org-1"):
    """The people the market read grants, from the stored document."""
    organization = MarketsApi._organization_from_document(copy.deepcopy(_stored(db, org_id)))
    assert organization is not None
    return dict(organization.people)


def _the_release_before(db, *updates, org_id="org-1"):
    """The release before's writes, each one ``update_one`` on the organization's id alone."""
    for update in updates:
        db.organizations.update_one({"id": org_id}, update)


#: Each change the release before makes, as its writes, and the people it leaves.
WHILE_ROLLED_BACK = {
    "removes an admin": (
        [{"$pull": {"admins": ADMIN}}],
        {OWNER: "owner", MEMBER: "member"}),
    "removes a member": (
        [{"$pull": {"members": MEMBER}}],
        {OWNER: "owner", ADMIN: "admin"}),
    "adds an admin": (
        [{"$addToSet": {"admins": NEW}}],
        {OWNER: "owner", ADMIN: "admin", MEMBER: "member", NEW: "admin"}),
    "adds a member": (
        [{"$addToSet": {"members": NEW}}],
        {OWNER: "owner", ADMIN: "admin", MEMBER: "member", NEW: "member"}),
    # Its "Add admin" of a member left them in `members` too; the admin place wins, as it always has.
    "makes a member an admin": (
        [{"$addToSet": {"admins": MEMBER}}],
        {OWNER: "owner", ADMIN: "admin", MEMBER: "admin"}),
    "hands it to a member": (
        [{"$pull": {"members": MEMBER}}, {"$addToSet": {"admins": OWNER}},
         {"$set": {"owner": MEMBER}}],
        {OWNER: "admin", ADMIN: "admin", MEMBER: "owner"}),
    "hands it to an admin": (
        [{"$pull": {"admins": ADMIN}}, {"$addToSet": {"admins": OWNER}},
         {"$set": {"owner": ADMIN}}],
        {OWNER: "admin", ADMIN: "owner", MEMBER: "member"}),
    # Its transfer cut after the owner was added to `admins` and before `owner` was set.
    "is cut handing it to an admin": (
        [{"$pull": {"admins": ADMIN}}, {"$addToSet": {"admins": OWNER}}],
        {OWNER: "owner", MEMBER: "member"}),
    "forgets a deleted account": (
        [{"$pull": {"members": MEMBER, "admins": MEMBER}}],
        {OWNER: "owner", ADMIN: "admin"}),
}


def test_an_admin_removed_while_rolled_back_keeps_no_place_once_reconciled():
    """The reviewer's case: the map's release reads the stale map until the reconcile runs."""
    db = _db(_folded())
    _the_release_before(db, {"$pull": {"admins": ADMIN}})
    assert _read(db)[ADMIN] == "admin"

    migrate(db, reconcile=True)

    assert ADMIN not in _read(db)
    assert_one_map(_stored(db))


@pytest.mark.parametrize("change", WHILE_ROLLED_BACK)
def test_each_change_the_release_before_makes_is_read_once_reconciled(change):
    updates, people = WHILE_ROLLED_BACK[change]
    db = _db(_folded())
    _the_release_before(db, *updates)

    counts = migrate(db, reconcile=True)

    assert _read(db) == people
    assert_one_map(_stored(db))
    assert counts["rebuilt"] == 1


def test_a_rebuilt_map_keeps_each_persons_position_and_adds_the_new_at_its_end():
    db = _db(_folded(people={MEMBER: "member", OWNER: "owner", ADMIN: "admin"}))
    _the_release_before(db, {"$addToSet": {"members": NEW}}, {"$addToSet": {"admins": MEMBER}})

    migrate(db, reconcile=True)

    assert list(_stored(db)["people"].items()) == [
        (MEMBER, "admin"), (OWNER, "owner"), (ADMIN, "admin"), (NEW, "member")]


def test_an_organization_in_step_is_never_written():
    # The map's own writes append to a list, so a list's order may differ from the map's.
    in_step = _folded(people={OWNER: "owner", ADMIN: "admin", MEMBER: "admin"})
    in_step["admins"] = [MEMBER, ADMIN]
    db = _db(copy.deepcopy(in_step))

    counts = migrate(db, reconcile=True)

    assert db.organizations.writes == []
    assert _stored(db) == in_step
    assert counts["rebuilt"] == 0 and counts["already_folded"] == 1


def test_lists_that_are_not_an_exact_mirror_are_rewritten_from_the_map_they_agree_with():
    db = _db(_folded())
    # An owner the release before's cut transfer left in `admins`, and an admin listed twice.
    _stored(db)["admins"] = [ADMIN, OWNER, ADMIN]

    counts = migrate(db, reconcile=True)

    assert _stored(db)["admins"] == [ADMIN]
    assert_one_map(_stored(db))
    assert counts["rebuilt"] == 1


def test_an_organization_made_while_rolled_back_is_folded_in_the_same_run():
    made = {"id": "org-new", "name": "Fixture org-new", "markets": [], "theme": None,
            "owner": OWNER, "admins": [ADMIN], "members": []}
    db = _db(_folded(), made)

    counts = migrate(db, reconcile=True)

    assert _stored(db, "org-new")["people"] == {OWNER: "owner", ADMIN: "admin"}
    assert counts["folded"] == 1 and counts["rebuilt"] == 0


def test_the_write_holds_the_map_and_the_lists_as_read():
    db = _db(_folded())
    _the_release_before(db, {"$pull": {"admins": ADMIN}})
    before = copy.deepcopy(_stored(db))
    written = len(db.organizations.writes)

    migrate(db, reconcile=True)

    [(query, update)] = db.organizations.writes[written:]
    assert query == {"id": "org-1", "people": before["people"], "owner": OWNER,
                     "admins": [], "members": [MEMBER]}
    assert update == {"$set": {"people": {OWNER: "owner", MEMBER: "member"}, "owner": OWNER,
                               "admins": [], "members": [MEMBER]}}


def test_a_change_landing_during_the_run_is_left_alone_and_rebuilt_by_a_second(capsys):
    db = _db(_folded())
    _the_release_before(db, {"$pull": {"admins": ADMIN}})

    def a_member_added_meanwhile():
        _stored(db)["members"].append(NEW)

    db.organizations.before_write = a_member_added_meanwhile

    counts = migrate(db, reconcile=True)

    assert _read(db)[ADMIN] == "admin"
    assert "org-1 'Fixture org-1': changed during the run; run again" in capsys.readouterr().out
    assert counts["changed"] == 1 and counts["rebuilt"] == 0

    again = migrate(db, reconcile=True)

    assert _read(db) == {OWNER: "owner", MEMBER: "member", NEW: "member"}
    assert again["rebuilt"] == 1


def test_the_dry_run_writes_nothing_and_says_who_moves(capsys):
    db = _db(_folded(), _folded("org-2"))
    _the_release_before(db, {"$pull": {"admins": ADMIN}}, {"$addToSet": {"members": NEW}})
    stored = copy.deepcopy(db.organizations.docs)
    written = len(db.organizations.writes)

    counts = migrate(db, reconcile=True, dry_run=True)

    assert len(db.organizations.writes) == written
    assert db.organizations.docs == stored
    out = capsys.readouterr().out
    assert (f"  ~ org-1 'Fixture org-1': its people differ from its lists "
            f"({ADMIN}: admin -> none; {NEW}: none -> member)") in out
    assert "Would rebuild 1 organization(s) from their lists; 1 in step." in out
    assert counts["rebuilt"] == 1 and counts["already_folded"] == 1


def test_a_second_run_changes_nothing(capsys):
    db = _db(_folded())
    _the_release_before(db, {"$pull": {"admins": ADMIN}})
    migrate(db, reconcile=True)
    written = len(db.organizations.writes)
    capsys.readouterr()

    counts = migrate(db, reconcile=True)

    assert len(db.organizations.writes) == written
    assert counts["rebuilt"] == 0
    assert "Nothing to fold: the migration has already run." in capsys.readouterr().out


def test_without_reconcile_a_folded_organization_is_never_rebuilt():
    """The map is the truth on the map's release: only an operator's reconcile, after a roll
    forward, reads the lists over it."""
    db = _db(_folded())
    _the_release_before(db, {"$pull": {"admins": ADMIN}})
    written = len(db.organizations.writes)

    counts = migrate(db)

    assert len(db.organizations.writes) == written
    assert _read(db)[ADMIN] == "admin"
    assert counts["rebuilt"] == 0


def test_a_change_judged_on_the_stale_map_before_the_reconcile_outlives_it(monkeypatch):
    """Why the reconcile is the first thing done after the roll forward (RELEASING.md "Rolling
    back", ADR 0025): until it runs, the map's release judges and writes on the stale map, and a
    write it lets through is kept by the reconcile. Here the release before handed the organization
    to ADMIN; the stale map still says OWNER owns it, so OWNER hands it to MEMBER, and once
    reconciled MEMBER owns it and ADMIN, its owner while rolled back, has no place in it."""
    accounts = {user_id: SimpleNamespace(id=user_id, email=f"{user_id}@example.com")
                for user_id in (OWNER, ADMIN, MEMBER)}
    monkeypatch.setattr(UsersApi, "get_user",
                        lambda email: next((a for a in accounts.values() if a.email == email), None))
    monkeypatch.setattr(UsersApi, "get_user_by_id", accounts.get)
    monkeypatch.setattr(History, "record_for_organization", lambda *args, **kwargs: None)
    db = _db(_folded())
    install_organizations(monkeypatch, db.organizations)
    _the_release_before(db, *WHILE_ROLLED_BACK["hands it to an admin"][0])

    OrganizationPeople.transfer("org-1", accounts[OWNER].email, accounts[MEMBER].email)
    migrate(db, reconcile=True)

    assert _read(db) == {OWNER: "admin", MEMBER: "owner"}
    assert_one_map(_stored(db))
