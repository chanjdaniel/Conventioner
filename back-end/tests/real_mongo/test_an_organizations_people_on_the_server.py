"""An organization's people on a real server, with real threads meeting (T283).

Each change to a person's place is one write conditional on the places it judged, and handing the
organization on is one write filtered on the giver being owner. The hermetic suite proves that
logic over the shared fake (``test_one_writer_holds_each_place_it_judged.py``,
``test_an_organizations_people_stay_one_map.py``); these run the losing branch where it lives:
each racing thread judges on its own read, and only then do the writes meet on the server.
"""
import threading

import pytest

import organization_people as OrganizationPeople
from organization_people import OrganizationChanged
from real_mongo import harness
from test_an_organizations_people_stay_one_map import assert_one_map

ORG = "org-race"
OWNER = "race-owner@example.com"
ADMIN = "race-admin@example.com"
MEMBER = "race-member@example.com"
NEW = "race-new@example.com"
#: How long a racing thread waits for the other at a meeting point, so a bug fails, not hangs.
MEETING_TIMEOUT_SECONDS = 20
#: The judgment, as the module holds it before any test wraps it.
JUDGE = OrganizationPeople.next_people


@pytest.fixture
def people(real_db):
    """An account for each address, and their ids by address."""
    import api.users as UsersApi
    from create_account import create_account

    return {email: create_account(UsersApi.users_collection, email, "fixture-password-1")
            for email in (OWNER, ADMIN, MEMBER, NEW)}


@pytest.fixture(params=["folded", "unfolded"])
def organization(request, real_db, people):
    """The organization: its owner, an admin and a member, stored with its people map or, as
    before the map, by its lists alone. Answers a reader of it as stored."""
    doc = {"id": ORG, "name": "Race Markets", "owner": people[OWNER], "admins": [people[ADMIN]],
           "members": [people[MEMBER]], "markets": [], "theme": None}
    if request.param == "folded":
        doc["people"] = {people[OWNER]: "owner", people[ADMIN]: "admin",
                         people[MEMBER]: "member"}
    real_db["organizations"].insert_one(doc)
    harness.warm(real_db["organizations"], 2)
    return lambda: real_db["organizations"].find_one({"id": ORG}, {"_id": 0})


@pytest.fixture
def judged_then(monkeypatch):
    """``judged_then(meet)``: every judgment of a change runs ``meet(thread)`` once it has judged,
    ``thread`` the racing thread's index, so the changes meet after their reads, before their
    writes."""
    here = threading.local()

    def install(meet):
        def judged(*args, **kwargs):
            try:
                return JUDGE(*args, **kwargs)
            finally:
                meet(here.thread)
        monkeypatch.setattr(OrganizationPeople, "next_people", judged)

    def as_thread(i, fn):
        here.thread = i
        return fn()

    install.as_thread = as_thread
    return install


def _outcomes(answered):
    """Which threads landed (answered None) and which met the other's change; any other answer
    fails the test with it."""
    unexpected = [a for a in answered if a is not None and not isinstance(a, OrganizationChanged)]
    assert unexpected == []
    return ([i for i, a in enumerate(answered) if a is None],
            [i for i, a in enumerate(answered) if isinstance(a, OrganizationChanged)])


def test_an_add_member_judged_before_the_owner_hands_that_person_the_organization_is_refused(
        organization, people, judged_then, race):
    # Thread 0, the admin, adds NEW as a member. Between its judgment and its write, thread 1, the
    # owner, adds NEW as an admin and hands them the organization. On dev the add then landed the
    # new owner in members, which did not parse.
    add_judged, handed_on = threading.Event(), threading.Event()

    def meet(thread):
        if thread == 0:
            add_judged.set()
            assert handed_on.wait(MEETING_TIMEOUT_SECONDS)

    judged_then(meet)

    def owner_adds_and_hands_on():
        assert add_judged.wait(MEETING_TIMEOUT_SECONDS)
        try:
            OrganizationPeople.add_admin(ORG, NEW, OWNER)
            OrganizationPeople.transfer(ORG, OWNER, NEW)
        finally:
            handed_on.set()

    changes = [lambda: OrganizationPeople.add_member(ORG, NEW, ADMIN), owner_adds_and_hands_on]
    answered = race(2, lambda i: judged_then.as_thread(i, changes[i]))

    assert answered[1] is None, answered
    assert isinstance(answered[0], OrganizationChanged), answered
    stored = organization()
    assert stored["people"][people[NEW]] == "owner"
    assert people[NEW] not in stored["members"]
    assert_one_map(stored)


def test_two_transfers_by_the_owner_to_two_people_land_one(organization, people, judged_then, race):
    both_judged = threading.Barrier(2, timeout=MEETING_TIMEOUT_SECONDS)
    judged_then(lambda _thread: both_judged.wait())
    to = [ADMIN, MEMBER]

    answered = race(2, lambda i: judged_then.as_thread(
        i, lambda: OrganizationPeople.transfer(ORG, OWNER, to[i])))

    landed, refused = _outcomes(answered)
    assert len(landed) == 1 and len(refused) == 1, answered
    stored = organization()
    assert stored["people"][people[to[landed[0]]]] == "owner"
    assert stored["people"][people[OWNER]] == "admin"
    assert stored["people"][people[to[refused[0]]]] != "owner"
    assert_one_map(stored)


@pytest.mark.parametrize("first", [0, 1], ids=["the transfer writes first",
                                             "the add admin writes first"])
def test_a_transfer_to_an_admin_beside_an_add_admin_keeps_the_mirror(
        organization, people, judged_then, race, first):
    # The transfer sets ``admins`` whole from the list as read; it holds that list, so an admin
    # added meanwhile is never dropped from it while the map keeps them. Both judge on one read,
    # then the one named writes first and the other only once it has returned.
    both_judged = threading.Barrier(2, timeout=MEETING_TIMEOUT_SECONDS)
    written = threading.Event()

    def meet(thread):
        both_judged.wait()
        if thread != first:
            assert written.wait(MEETING_TIMEOUT_SECONDS)

    judged_then(meet)
    changes = [lambda: OrganizationPeople.transfer(ORG, OWNER, ADMIN),
               lambda: OrganizationPeople.add_admin(ORG, NEW, OWNER)]

    def change(i):
        try:
            return changes[i]()
        finally:
            if i == first:
                written.set()

    answered = race(2, lambda i: judged_then.as_thread(i, lambda: change(i)))

    landed, refused = _outcomes(answered)
    assert (landed, refused) == ([first], [1 - first]), answered
    stored = organization()
    if first == 0:
        assert stored["people"][people[ADMIN]] == "owner" and people[NEW] not in stored["people"]
    else:
        assert stored["people"][people[NEW]] == "admin" and people[NEW] in stored["admins"]
        assert stored["people"][people[OWNER]] == "owner"
    assert_one_map(stored)


# ── The migration ────────────────────────────────────────────────────────────────────────────


def _stored_organizations(real_db):
    return {doc["id"]: doc for doc in real_db["organizations"].find({}, {"_id": 0})}


def test_the_migration_folds_every_shape_on_the_server_and_a_second_run_changes_nothing(real_db):
    from migrate_organization_people import migrate
    from test_migrate_organization_people import SHAPES

    real_db["organizations"].insert_many([
        {"id": f"org-{i}", "name": f"Fixture {i}", "markets": [], **lists}
        for i, (lists, _people) in enumerate(SHAPES.values())
    ] + [{"id": "org-none", "name": "Fixture none", "owner": "", "admins": ["u-a"],
          "markets": []}])
    before = _stored_organizations(real_db)

    dry = migrate(real_db, dry_run=True)

    assert _stored_organizations(real_db) == before
    assert migrate(real_db) == dry
    stored = _stored_organizations(real_db)
    for i, (_lists, people) in enumerate(SHAPES.values()):
        assert list(stored[f"org-{i}"]["people"].items()) == list(people.items())
        assert_one_map(stored[f"org-{i}"])
    assert stored["org-none"] == before["org-none"]

    again = migrate(real_db)

    assert _stored_organizations(real_db) == stored
    assert again["folded"] == 0 and again["already_folded"] == len(SHAPES)


def test_the_migrations_write_leaves_alone_a_change_landing_during_it(
        real_db, people, monkeypatch):
    # The migration reads the organization stored before the map, then, before its write, the
    # owner adds NEW as an admin, which folds it with NEW in. The migration's write, held on what
    # it read, matches nothing and leaves the owner's change whole; it lists it, and a second run
    # finds it folded.
    import migrate_organization_people as Migration

    real_db["organizations"].insert_one(
        {"id": ORG, "name": "Race Markets", "owner": people[OWNER], "admins": [people[ADMIN]],
         "members": [people[MEMBER], people[OWNER]], "markets": [], "theme": None})
    planned = Migration.folding_write

    def owner_adds_an_admin_meanwhile(org, folded):
        write = planned(org, folded)
        OrganizationPeople.add_admin(ORG, NEW, OWNER)
        return write

    monkeypatch.setattr(Migration, "folding_write", owner_adds_an_admin_meanwhile)

    counts = Migration.migrate(real_db)

    assert counts["changed"] == 1 and counts["folded"] == 0
    stored = real_db["organizations"].find_one({"id": ORG}, {"_id": 0})
    assert list(stored["people"].items()) == [
        (people[OWNER], "owner"), (people[ADMIN], "admin"), (people[MEMBER], "member"),
        (people[NEW], "admin")]
    assert_one_map(stored)

    monkeypatch.setattr(Migration, "folding_write", planned)
    again = Migration.migrate(real_db)

    assert again["already_folded"] == 1 and again["changed"] == 0
    assert real_db["organizations"].find_one({"id": ORG}, {"_id": 0}) == stored
