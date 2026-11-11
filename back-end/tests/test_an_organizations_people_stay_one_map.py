"""No sequence of changes breaks an organization's people map, and handing it on is one write
(T283).

An organization's people are one map, ``{user_id: "owner" | "admin" | "member"}``, written only by
``organization_people``, its lists kept as an exact mirror. Handing the organization on is one
conditional write filtered on the giver being owner, so no cut and no read finds it with two owners,
none, or an owner in a list: on ``dev`` at ``279afc56`` it was four unconditional writes, and the
planner's probes cut between them left an organization that did not parse, or a new owner with no
place in it at all.

The property test drives random sequences of every change, by random requesters on random targets,
a third of them with a second change landing between the first's read and its write, through the
module over the shared organizations fake, which filters and writes as the server does; after each
change the map holds exactly one owner and one place per person, its lists mirror it, it parses, and
a change nothing met leaves the map ``next_people`` answers.
"""
import copy
import random
from types import SimpleNamespace

import pytest

from conftest import (
    FakeAccountCopies,
    FakeOrganizations,
    WriteCut,
    install_organizations,
    skip_without_real_dependencies,
)

skip_without_real_dependencies()

import api.markets as MarketsApi
import api.organizations as OrgsApi
import api.users as UsersApi
import history as History
import organization_people as OrganizationPeople
from client_errors import ClientError
from datatypes import organization_people_of
from organization_people import PLACE_CHANGES, Event, next_people

ORG = "org-1"
OWNER = SimpleNamespace(id="user-owner", email="owner@example.com")
ADMIN = SimpleNamespace(id="user-admin", email="admin@example.com")
MEMBER = SimpleNamespace(id="user-member", email="member@example.com")
SECOND_ADMIN = SimpleNamespace(id="user-admin-2", email="admin-2@example.com")
SECOND_MEMBER = SimpleNamespace(id="user-member-2", email="member-2@example.com")
OUTSIDER = SimpleNamespace(id="user-out", email="outsider@example.com")
#: The six accounts every requester and target of the property test is drawn from.
PEOPLE = (OWNER, ADMIN, MEMBER, SECOND_ADMIN, SECOND_MEMBER, OUTSIDER)

UNFOLDED = {
    "id": ORG, "name": "Ember Markets", "owner": OWNER.id, "admins": [ADMIN.id],
    "members": [MEMBER.id], "markets": [], "theme": None,
}
FOLDED = {**UNFOLDED, "people": {OWNER.id: "owner", ADMIN.id: "admin", MEMBER.id: "member"}}
SHAPES = {"folded": FOLDED, "unfolded": UNFOLDED}


@pytest.fixture
def recorded(monkeypatch):
    entries = []
    monkeypatch.setattr(History, "record_for_organization",
                        lambda *args, **kwargs: entries.append((args, kwargs)))
    return entries


@pytest.fixture
def accounts(monkeypatch):
    by_email = {person.email: person for person in PEOPLE}
    by_id = {person.id: person for person in PEOPLE}
    monkeypatch.setattr(UsersApi, "get_user", by_email.get)
    monkeypatch.setattr(UsersApi, "get_user_by_id", by_id.get)


def assert_one_map(doc):
    """Every invariant of an organization's people: one owner, each value a place, the lists an
    exact mirror of the map with no id twice, and the document parses with the same people."""
    people = organization_people_of(doc)
    assert set(people.values()) <= {"owner", "admin", "member"}, people
    owners = [user_id for user_id, place in people.items() if place == "owner"]
    assert len(owners) == 1, people
    admins = [user_id for user_id, place in people.items() if place == "admin"]
    members = [user_id for user_id, place in people.items() if place == "member"]
    assert doc["owner"] == owners[0]
    assert len(doc["admins"]) == len(set(doc["admins"])), doc["admins"]
    assert len(doc["members"]) == len(set(doc["members"])), doc["members"]
    assert set(doc["admins"]) == set(admins), (doc["admins"], people)
    assert set(doc["members"]) == set(members), (doc["members"], people)
    parsed = MarketsApi._organization_from_document(copy.deepcopy(doc))
    assert parsed is not None, doc
    assert parsed.people == people


# ── Failing first: the planner's two transfer-cut probes ─────────────────────────────────────

HANDED_ON = {OWNER.id: "admin", ADMIN.id: "admin", MEMBER.id: "owner"}


def _as_it_was_or_handed_on(doc):
    """The organization reads exactly as it was, or exactly as handed on to MEMBER: nothing
    between."""
    people = organization_people_of(doc)
    assert people in (FOLDED["people"], HANDED_ON), people
    assert_one_map(doc)


@pytest.mark.parametrize("shape", sorted(SHAPES))
def test_a_transfer_cut_before_its_owner_write_leaves_an_organization_that_parses(
        monkeypatch, accounts, recorded, shape):
    # On dev the transfer to a member wrote: the member pulled (1), the owner added to admins (2),
    # the owner set (3). Cut at the third, the owner stood in its own admins and the organization
    # did not parse, so its admin held nothing through it on any market. Now the transfer is one
    # write, and a cut where the third was finds it handed on whole.
    stored = install_organizations(monkeypatch, FakeOrganizations(SHAPES[shape]))
    stored.cut_at = 3

    try:
        OrgsApi.transfer_org_ownership(ORG, OWNER.email, MEMBER.email)
    except WriteCut:
        pass

    _as_it_was_or_handed_on(stored.doc)


@pytest.mark.parametrize("shape", sorted(SHAPES))
def test_a_transfer_cut_after_the_pull_leaves_the_new_owner_a_place(
        monkeypatch, accounts, recorded, shape):
    # On dev a cut after the transfer's first write, the pull, left the member it was handed to
    # with no place in it at all. Now there is no write between the pull and the owner's.
    stored = install_organizations(monkeypatch, FakeOrganizations(SHAPES[shape]))
    stored.cut_at = 2

    try:
        OrgsApi.transfer_org_ownership(ORG, OWNER.email, MEMBER.email)
    except WriteCut:
        pass

    _as_it_was_or_handed_on(stored.doc)
    assert organization_people_of(stored.doc).get(MEMBER.id) is not None


# ── A cut at each write a transfer makes ─────────────────────────────────────────────────────


class CutAccountCopies(FakeAccountCopies):
    """The users collection, its connection lost at the account copy's write."""

    def update_one(self, query, update, **_kwargs):
        raise WriteCut("the connection was lost at the account copy's write")


def _cut_history(*_args, **_kwargs):
    raise WriteCut("the connection was lost at the history's write")


@pytest.mark.parametrize("shape", sorted(SHAPES))
@pytest.mark.parametrize("new_owner", [MEMBER, ADMIN], ids=["from a member", "from an admin"])
@pytest.mark.parametrize("cut", ["the organization's", "the account copy's", "the history's"])
def test_a_cut_at_each_write_of_a_transfer_leaves_one_owner(
        monkeypatch, accounts, shape, new_owner, cut):
    accounts_fake = CutAccountCopies() if cut == "the account copy's" else None
    stored = install_organizations(monkeypatch, FakeOrganizations(SHAPES[shape]), accounts_fake)
    if cut == "the organization's":
        stored.cut_at = 1
    monkeypatch.setattr(
        History, "record_for_organization",
        _cut_history if cut == "the history's" else lambda *_a, **_k: None)

    with pytest.raises(WriteCut):
        OrgsApi.transfer_org_ownership(ORG, OWNER.email, new_owner.email)

    assert_one_map(stored.doc)
    people = organization_people_of(stored.doc)
    if cut == "the organization's":
        assert stored.doc == SHAPES[shape], "a cut write stored something"
    else:
        assert people[new_owner.id] == "owner" and people[OWNER.id] == "admin"


# ── The property: no sequence of changes breaks the map ──────────────────────────────────────

SEEDS = range(50)
EVENTS_PER_SEED = 40
#: The events the property draws from; a place change is drawn as one, its place at random.
DRAWN = (Event.ADD_ADMIN, Event.ADD_MEMBER, "change place", Event.REMOVE, Event.TRANSFER)


def _draw(rng):
    """One change: the event, by whom, on whom."""
    event = rng.choice(DRAWN)
    if event == "change place":
        event = PLACE_CHANGES[rng.choice(sorted(PLACE_CHANGES))]
    return event, rng.choice(PEOPLE), rng.choice(PEOPLE)


def _run(event, requester, target):
    """The change through the module's public function a route calls."""
    if event is Event.ADD_ADMIN:
        OrganizationPeople.add_admin(ORG, target.email, requester.email)
    elif event is Event.ADD_MEMBER:
        OrganizationPeople.add_member(ORG, target.email, requester.email)
    elif event in (Event.CHANGE_TO_ADMIN, Event.CHANGE_TO_MEMBER):
        place = next(place for place, change in PLACE_CHANGES.items() if change is event)
        OrganizationPeople.change_place(ORG, target.id, place, requester.email)
    elif event is Event.REMOVE:
        OrganizationPeople.remove(ORG, target.id, requester.email)
    elif event is Event.TRANSFER:
        OrganizationPeople.transfer(ORG, requester.email, target.email)
    else:
        raise AssertionError(f"not drawn: {event}")


def _answer(run):
    """None when the change landed (or changed nothing), else the client error it answered."""
    try:
        run()
    except ClientError as refused:
        return refused
    return None


@pytest.mark.parametrize("seed", SEEDS)
def test_no_sequence_of_changes_breaks_the_map(monkeypatch, accounts, recorded, seed):
    rng = random.Random(seed)
    stored = install_organizations(
        monkeypatch, FakeOrganizations(SHAPES["unfolded" if seed % 2 else "folded"]))
    interleaved = 0

    for step in range(EVENTS_PER_SEED):
        event, requester, target = _draw(rng)
        before = organization_people_of(stored.doc)
        meets = rng.random() < 1 / 3
        if meets:
            interleaved += 1
            second = _draw(rng)
            stored.before_write = lambda second=second: _answer(lambda: _run(*second))

        answered = _answer(lambda: _run(event, requester, target))
        # A change refused before its write leaves the hook unspent; it is this change's alone.
        stored.before_write = None

        where = f"seed {seed}, step {step}: {event.value} by {requester.id} of {target.id}"
        try:
            assert_one_map(stored.doc)
        except AssertionError as broken:
            raise AssertionError(f"{where}: {broken}") from broken
        if meets:
            continue
        try:
            expected, refusal = next_people(before, event, requester.id, target.id), None
        except ClientError as refused:
            expected, refusal = before, refused
        after = organization_people_of(stored.doc)
        assert list(after.items()) == list(expected.items()), where
        if refusal is None:
            assert answered is None, (where, answered)
        else:
            assert (type(answered), getattr(answered, "message", None)) == (
                type(refusal), refusal.message), where

    assert interleaved, f"seed {seed} met no change"
