"""One writer changes a person's place in an organization, holding the places it judged (T283).

"Add admin", "Add member", "Remove" and the owner's place change ("Make member", "Make admin")
change an organization's people only through
``organization_people``: its table (``next_people``) says what each change does to the target's
place as read and who may ask for it, and each change is one conditional write that lands only
while the requester's and the target's places still stand as read. On an organization stored before
the people map, the write holds its three lists as read and folds the map in. Every write keeps
``owner``, ``admins`` and ``members`` an exact mirror of the map.

A write that met another change answers 404 when the organization, or the person being removed, is
gone, and otherwise ``OrganizationChanged``, a 409 in the spec's words: an "Add member" judged
before the owner handed the organization to that same person used to land the new owner in
``members``, an organization that did not parse (the planner's probe on ``dev`` at ``279afc56``).

Driven through the module's public functions and the Flask client, over the shared organizations
fake, which filters and writes as the server does.
"""
import copy
from types import SimpleNamespace

import pytest

from conftest import (
    FakeOrganizations,
    install_organizations,
    sessions_load_through_get_user,
    skip_without_real_dependencies,
)

skip_without_real_dependencies()

import app as app_module
import api.markets as MarketsApi
import api.organizations as OrgsApi
import api.users as UsersApi
import history as History
import organization_people as OrganizationPeople
from client_errors import BadRequestError, ForbiddenError, NotFoundError
from datatypes import organization_people_of
from organization_people import (
    ALREADY_A_MEMBER,
    ALREADY_AN_ADMIN,
    NO_LONGER_IN_THE_ORGANIZATION,
    ORGANIZATION_CHANGED,
    THE_OWNERS_PLACE,
    Event,
    OrganizationChanged,
    next_people,
)

ORG = "org-1"
OWNER = SimpleNamespace(id="user-owner", email="owner@example.com")
ADMIN = SimpleNamespace(id="user-admin", email="admin@example.com")
MEMBER = SimpleNamespace(id="user-member", email="member@example.com")
NEW = SimpleNamespace(id="user-new", email="new@example.com")
OUTSIDER = SimpleNamespace(id="user-out", email="outsider@example.com")
PEOPLE = (OWNER, ADMIN, MEMBER, NEW, OUTSIDER)

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

    def account(email):
        person = by_email.get(email)
        return person and SimpleNamespace(
            id=person.id, email=email, is_active=True, is_authenticated=True,
            is_anonymous=False, get_id=lambda e=email: e,
        )
    monkeypatch.setattr(UsersApi, "get_user", account)
    monkeypatch.setattr(UsersApi, "get_user_by_id", by_id.get)
    monkeypatch.setattr(UsersApi, "get_users_by_ids",
                        lambda ids: {i: by_id[i] for i in ids if i in by_id})


@pytest.fixture(params=sorted(SHAPES))
def shape(request):
    return request.param


@pytest.fixture
def stored(monkeypatch, accounts, recorded, shape):
    """The organization, in the shape the test is parametrized over."""
    return install_organizations(monkeypatch, FakeOrganizations(SHAPES[shape]))


def assert_one_map(doc):
    """The organization parses, with one owner, and its lists are an exact mirror of its map."""
    people = organization_people_of(doc)
    assert list(people.values()).count("owner") == 1
    assert doc["owner"] == next(user_id for user_id, place in people.items() if place == "owner")
    assert sorted(doc["admins"]) == sorted(u for u, place in people.items() if place == "admin")
    assert sorted(doc["members"]) == sorted(u for u, place in people.items() if place == "member")
    assert len(set(doc["admins"]) | set(doc["members"])) == len(doc["admins"]) + len(doc["members"])
    assert MarketsApi._organization_from_document(copy.deepcopy(doc)) is not None


def places(doc):
    return organization_people_of(doc)


# ── Failing first: the planner's add-member interleaving probe ───────────────────────────────


def test_an_add_member_judged_before_a_transfer_to_that_person_is_refused(stored, recorded):
    # The admin adds NEW as a member; between its read and its write the owner hands NEW the
    # organization. On dev the add landed: owner NEW and NEW in members, which does not parse.
    stored.before_write = lambda: OrgsApi.transfer_org_ownership(ORG, OWNER.email, NEW.email)

    with pytest.raises(OrganizationChanged):
        OrgsApi.add_org_member(ORG, NEW.email, ADMIN.email)

    assert places(stored.doc)[NEW.id] == "owner"
    assert NEW.id not in stored.doc["members"]
    assert_one_map(stored.doc)
    # Only the transfer is recorded: the refused add wrote and recorded nothing.
    assert [args[2] for args, _ in recorded] == [History.TRANSFER_ORGANIZATION]


# ── The table, cell by cell, through ``next_people`` ─────────────────────────────────────────

ONLY_THE_OWNER_CHANGES_A_PLACE = "Only the organization's owner can change someone's place in it."

AS_READ = {OWNER.id: "owner", ADMIN.id: "admin", MEMBER.id: "member"}
TARGET_IN = {None: NEW.id, "member": MEMBER.id, "admin": ADMIN.id, "owner": OWNER.id}

#: (event, requester, the target's place as read, the target's place after, or the refusal).
CELLS = [
    (Event.ADD_ADMIN, OWNER, None, "admin"),
    (Event.ADD_ADMIN, OWNER, "member", "admin"),
    (Event.ADD_ADMIN, OWNER, "admin", (BadRequestError, ALREADY_AN_ADMIN)),
    (Event.ADD_ADMIN, OWNER, "owner", (BadRequestError, "Owner cannot be added as admin")),
    (Event.ADD_MEMBER, OWNER, None, "member"),
    (Event.ADD_MEMBER, ADMIN, None, "member"),
    (Event.ADD_MEMBER, OWNER, "member", (BadRequestError, ALREADY_A_MEMBER)),
    (Event.ADD_MEMBER, OWNER, "admin", (BadRequestError, "Admin cannot be added as member")),
    (Event.ADD_MEMBER, ADMIN, "owner", (BadRequestError, "Owner cannot be added as member")),
    (Event.REMOVE, OWNER, None, (NotFoundError, NO_LONGER_IN_THE_ORGANIZATION)),
    (Event.REMOVE, OWNER, "member", None),
    (Event.REMOVE, ADMIN, "member", None),
    (Event.REMOVE, OWNER, "admin", None),
    (Event.REMOVE, ADMIN, "admin", (ForbiddenError, "Only owner can remove admins")),
    (Event.REMOVE, ADMIN, "owner",
     (BadRequestError, "Cannot remove organization owner. Transfer ownership first.")),
    (Event.CHANGE_TO_ADMIN, OWNER, None, (NotFoundError, NO_LONGER_IN_THE_ORGANIZATION)),
    (Event.CHANGE_TO_ADMIN, OWNER, "member", "admin"),
    (Event.CHANGE_TO_ADMIN, OWNER, "admin", "admin"),
    (Event.CHANGE_TO_ADMIN, OWNER, "owner", (BadRequestError, THE_OWNERS_PLACE)),
    (Event.CHANGE_TO_MEMBER, OWNER, None, (NotFoundError, NO_LONGER_IN_THE_ORGANIZATION)),
    (Event.CHANGE_TO_MEMBER, OWNER, "member", "member"),
    (Event.CHANGE_TO_MEMBER, OWNER, "admin", "member"),
    (Event.CHANGE_TO_MEMBER, OWNER, "owner", (BadRequestError, THE_OWNERS_PLACE)),
    (Event.FORGET, None, None, None),
    (Event.FORGET, None, "member", None),
    (Event.FORGET, None, "admin", None),
]


@pytest.mark.parametrize(
    "event,requester,place,outcome", CELLS,
    ids=[f"{e.value} by {r.id if r else 'nobody'} of {p}" for e, r, p, _ in CELLS])
def test_a_cell_of_the_table(event, requester, place, outcome):
    as_read = dict(AS_READ)
    target = TARGET_IN[place]
    requester_id = requester.id if requester else None

    if isinstance(outcome, tuple):
        error, sentence = outcome
        with pytest.raises(error) as refused:
            next_people(as_read, event, requester_id, target)
        assert refused.value.message == sentence
        assert as_read == AS_READ
        return

    after = next_people(as_read, event, requester_id, target)
    assert after.get(target) == outcome
    assert {k: v for k, v in after.items() if k != target} == {
        k: v for k, v in AS_READ.items() if k != target}
    assert as_read == AS_READ


def test_a_member_made_an_admin_keeps_their_place_in_the_maps_order():
    after = next_people(AS_READ, Event.ADD_ADMIN, OWNER.id, MEMBER.id)
    assert list(after) == [OWNER.id, ADMIN.id, MEMBER.id]


def test_an_admin_made_a_member_keeps_their_place_in_the_maps_order():
    after = next_people(AS_READ, Event.CHANGE_TO_MEMBER, OWNER.id, ADMIN.id)
    assert list(after) == [OWNER.id, ADMIN.id, MEMBER.id]


def test_someone_added_joins_the_map_at_its_end():
    after = next_people(AS_READ, Event.ADD_MEMBER, OWNER.id, NEW.id)
    assert list(after) == [OWNER.id, ADMIN.id, MEMBER.id, NEW.id]


def test_forgetting_an_owner_is_never_reached():
    with pytest.raises(RuntimeError):
        next_people(AS_READ, Event.FORGET, None, OWNER.id)


#: (event, requester, the refusal of anyone else): checked before the target's place.
AUTHORITY_CELLS = [
    (Event.ADD_ADMIN, ADMIN, "Only organization owner can add admins"),
    (Event.ADD_ADMIN, MEMBER, "Only organization owner can add admins"),
    (Event.ADD_ADMIN, OUTSIDER, "Only organization owner can add admins"),
    (Event.ADD_MEMBER, MEMBER, "Only organization owner or admin can add members"),
    (Event.ADD_MEMBER, OUTSIDER, "Only organization owner or admin can add members"),
    (Event.REMOVE, MEMBER, "Only organization owner or admin can remove users"),
    (Event.REMOVE, OUTSIDER, "Only organization owner or admin can remove users"),
    (Event.CHANGE_TO_ADMIN, ADMIN, ONLY_THE_OWNER_CHANGES_A_PLACE),
    (Event.CHANGE_TO_ADMIN, MEMBER, ONLY_THE_OWNER_CHANGES_A_PLACE),
    (Event.CHANGE_TO_MEMBER, ADMIN, ONLY_THE_OWNER_CHANGES_A_PLACE),
    (Event.CHANGE_TO_MEMBER, OUTSIDER, ONLY_THE_OWNER_CHANGES_A_PLACE),
]


@pytest.mark.parametrize("event,requester,sentence", AUTHORITY_CELLS,
                         ids=[f"{e.value} by {r.id}" for e, r, _ in AUTHORITY_CELLS])
def test_a_requester_without_the_authority_is_refused_before_the_target(
        event, requester, sentence):
    # The target is one the table would refuse anyway (the owner): authority answers first.
    with pytest.raises(ForbiddenError) as refused:
        next_people(AS_READ, event, requester.id, OWNER.id)
    assert refused.value.message == sentence


# ── The same, through the routes ─────────────────────────────────────────────────────────────


@pytest.fixture
def client(monkeypatch, stored):
    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    sessions_load_through_get_user(monkeypatch)
    return app_module.app.test_client()


def signed_in(client, person):
    with client.session_transaction() as session:
        session["_user_id"] = person.email
        session["_fresh"] = True
    return client


def add(client, person, list_name, email):
    return signed_in(client, person).post(
        f"/organizations/{ORG}/{list_name}", json={"user_email": email})


def remove(client, person, user_id):
    return signed_in(client, person).delete(f"/organizations/{ORG}/users/{user_id}")


def change(client, person, user_id, body):
    return signed_in(client, person).put(f"/organizations/{ORG}/users/{user_id}", json=body)


ROUTE_AUTHORITY = [
    ("admins", ADMIN, NEW.email, "Only organization owner can add admins"),
    ("admins", MEMBER, NEW.email, "Only organization owner can add admins"),
    ("admins", OUTSIDER, NEW.email, "Only organization owner can add admins"),
    ("members", MEMBER, NEW.email, "Only organization owner or admin can add members"),
    ("members", OUTSIDER, NEW.email, "Only organization owner or admin can add members"),
]


@pytest.mark.parametrize("list_name,requester,email,sentence", ROUTE_AUTHORITY,
                         ids=[f"{n} by {r.id}" for n, r, _, _ in ROUTE_AUTHORITY])
def test_an_add_by_someone_without_the_authority_is_a_403(
        client, stored, recorded, list_name, requester, email, sentence):
    response = add(client, requester, list_name, email)

    assert (response.status_code, response.get_json()) == (403, {"error": sentence})
    assert stored.writes == [] and recorded == []


@pytest.mark.parametrize("requester", [MEMBER, OUTSIDER], ids=lambda p: p.id)
def test_a_remove_by_someone_without_the_authority_is_a_403(client, stored, recorded, requester):
    response = remove(client, requester, MEMBER.id)

    assert (response.status_code, response.get_json()) == (
        403, {"error": "Only organization owner or admin can remove users"})
    assert stored.writes == [] and recorded == []


ROUTE_REFUSALS = [
    ("admins", ADMIN.email, 400, ALREADY_AN_ADMIN),
    ("admins", OWNER.email, 400, "Owner cannot be added as admin"),
    ("admins", "nobody@example.com", 400, "User not found"),
    ("members", MEMBER.email, 400, ALREADY_A_MEMBER),
    ("members", ADMIN.email, 400, "Admin cannot be added as member"),
    ("members", OWNER.email, 400, "Owner cannot be added as member"),
    ("members", "nobody@example.com", 400, "User not found"),
]


@pytest.mark.parametrize("list_name,email,status,sentence", ROUTE_REFUSALS,
                         ids=[f"{n} {e}" for n, e, _, _ in ROUTE_REFUSALS])
def test_an_add_the_table_refuses_says_why_and_writes_nothing(
        client, stored, recorded, list_name, email, status, sentence):
    response = add(client, OWNER, list_name, email)

    assert (response.status_code, response.get_json()) == (status, {"error": sentence})
    assert stored.writes == [] and recorded == []


@pytest.mark.parametrize("target,status,sentence", [
    (OWNER.id, 400, "Cannot remove organization owner. Transfer ownership first."),
    (NEW.id, 404, NO_LONGER_IN_THE_ORGANIZATION),
    # An id from the address that no map holds is not in it, never a path the server builds.
    ("a.b", 404, NO_LONGER_IN_THE_ORGANIZATION),
    ("$where", 404, NO_LONGER_IN_THE_ORGANIZATION),
], ids=["the owner", "someone not in it", "a dotted id", "a dollar id"])
def test_a_remove_the_table_refuses_says_why_and_writes_nothing(
        client, stored, recorded, target, status, sentence):
    response = remove(client, OWNER, target)

    assert (response.status_code, response.get_json()) == (status, {"error": sentence})
    assert stored.writes == [] and recorded == []


def test_an_admin_removing_an_admin_is_a_403(client, stored, recorded):
    response = remove(client, ADMIN, ADMIN.id)

    assert (response.status_code, response.get_json()) == (
        403, {"error": "Only owner can remove admins"})
    assert stored.writes == [] and recorded == []


@pytest.mark.parametrize("list_name,email,message", [
    ("admins", NEW.email, "Admin added successfully"),
    ("admins", MEMBER.email, "Admin added successfully"),
    ("members", NEW.email, "Member added successfully"),
])
def test_an_add_the_table_allows_answers_200(client, stored, list_name, email, message):
    response = add(client, OWNER, list_name, email)

    assert (response.status_code, response.get_json()) == (200, {"message": message})
    assert_one_map(stored.doc)


@pytest.mark.parametrize("target,place", [(ADMIN, "member"), (MEMBER, "admin")],
                         ids=["an admin made a member", "a member made an admin"])
def test_the_owner_changes_a_persons_place(client, stored, recorded, target, place):
    response = change(client, OWNER, target.id, {"place": place})

    assert (response.status_code, response.get_json()) == (200, {"message": "Place changed"})
    assert places(stored.doc)[target.id] == place
    assert len(stored.writes) == 1 and len(recorded) == 1
    assert_one_map(stored.doc)


@pytest.mark.parametrize("target,place", [(ADMIN, "admin"), (MEMBER, "member")],
                         ids=["an admin made an admin", "a member made a member"])
def test_a_place_set_to_the_place_held_answers_200_and_writes_nothing(
        client, stored, recorded, target, place):
    response = change(client, OWNER, target.id, {"place": place})

    assert (response.status_code, response.get_json()) == (200, {"message": "Place changed"})
    assert stored.writes == [] and stored.accounts.writes == [] and recorded == []


@pytest.mark.parametrize("requester,target", [
    (ADMIN, MEMBER), (ADMIN, ADMIN), (MEMBER, MEMBER), (OUTSIDER, ADMIN),
], ids=lambda p: p.id)
def test_a_place_change_by_anyone_but_the_owner_is_a_403(
        client, stored, recorded, requester, target):
    response = change(client, requester, target.id, {"place": "admin"})

    assert (response.status_code, response.get_json()) == (
        403, {"error": ONLY_THE_OWNER_CHANGES_A_PLACE})
    assert stored.writes == [] and recorded == []


@pytest.mark.parametrize("target,body,status,sentence", [
    (OWNER.id, {"place": "member"}, 400, THE_OWNERS_PLACE),
    (OWNER.id, {"place": "admin"}, 400, THE_OWNERS_PLACE),
    (NEW.id, {"place": "admin"}, 404, NO_LONGER_IN_THE_ORGANIZATION),
    ("a.b", {"place": "member"}, 404, NO_LONGER_IN_THE_ORGANIZATION),
    ("$where", {"place": "member"}, 404, NO_LONGER_IN_THE_ORGANIZATION),
    (MEMBER.id, {"place": "owner"}, 400, "A place is admin or member."),
    (MEMBER.id, {"place": "Admin"}, 400, "A place is admin or member."),
    (MEMBER.id, {"place": ["admin"]}, 400, "A place is admin or member."),
    (MEMBER.id, {"place": ""}, 400, "A place is admin or member."),
    (MEMBER.id, {"role": "admin"}, 400, "A place is admin or member."),
], ids=["the owner made a member", "the owner made an admin", "someone not in it",
        "a dotted id", "a dollar id", "owner as a place", "a place in capitals",
        "a place in a list", "an empty place", "no place"])
def test_a_place_change_the_table_refuses_says_why_and_writes_nothing(
        client, stored, recorded, target, body, status, sentence):
    response = change(client, OWNER, target, body)

    assert (response.status_code, response.get_json()) == (status, {"error": sentence})
    assert stored.writes == [] and recorded == []


# ── What each write holds and writes ─────────────────────────────────────────────────────────


def the_write(stored):
    [write] = stored.writes
    return write


HELD_UNFOLDED = {"id": ORG, "people": {"$exists": False}, "owner": OWNER.id,
                 "admins": [ADMIN.id], "members": [MEMBER.id]}

#: (what is done, the folded write's filter and update, the map after).
WRITES = [
    (lambda: OrganizationPeople.add_admin(ORG, NEW.email, OWNER.email),
     {"id": ORG, "people.user-owner": "owner", "people.user-new": {"$exists": False}},
     {"$set": {"people.user-new": "admin"}, "$addToSet": {"admins": NEW.id}},
     {OWNER.id: "owner", ADMIN.id: "admin", MEMBER.id: "member", NEW.id: "admin"}),
    (lambda: OrganizationPeople.add_member(ORG, NEW.email, ADMIN.email),
     {"id": ORG, "people.user-admin": "admin", "people.user-new": {"$exists": False}},
     {"$set": {"people.user-new": "member"}, "$addToSet": {"members": NEW.id}},
     {OWNER.id: "owner", ADMIN.id: "admin", MEMBER.id: "member", NEW.id: "member"}),
    (lambda: OrganizationPeople.add_admin(ORG, MEMBER.email, OWNER.email),
     {"id": ORG, "people.user-owner": "owner", "people.user-member": "member"},
     {"$set": {"people.user-member": "admin"}, "$addToSet": {"admins": MEMBER.id},
      "$pull": {"members": MEMBER.id}},
     {OWNER.id: "owner", ADMIN.id: "admin", MEMBER.id: "admin"}),
    (lambda: OrganizationPeople.remove(ORG, ADMIN.id, OWNER.email),
     {"id": ORG, "people.user-owner": "owner", "people.user-admin": "admin"},
     {"$unset": {"people.user-admin": ""}, "$pull": {"admins": ADMIN.id, "members": ADMIN.id}},
     {OWNER.id: "owner", MEMBER.id: "member"}),
    (lambda: OrganizationPeople.remove(ORG, MEMBER.id, ADMIN.email),
     {"id": ORG, "people.user-admin": "admin", "people.user-member": "member"},
     {"$unset": {"people.user-member": ""},
      "$pull": {"admins": MEMBER.id, "members": MEMBER.id}},
     {OWNER.id: "owner", ADMIN.id: "admin"}),
    (lambda: OrganizationPeople.change_place(ORG, ADMIN.id, "member", OWNER.email),
     {"id": ORG, "people.user-owner": "owner", "people.user-admin": "admin"},
     {"$set": {"people.user-admin": "member"}, "$addToSet": {"members": ADMIN.id},
      "$pull": {"admins": ADMIN.id}},
     {OWNER.id: "owner", ADMIN.id: "member", MEMBER.id: "member"}),
    (lambda: OrganizationPeople.change_place(ORG, MEMBER.id, "admin", OWNER.email),
     {"id": ORG, "people.user-owner": "owner", "people.user-member": "member"},
     {"$set": {"people.user-member": "admin"}, "$addToSet": {"admins": MEMBER.id},
      "$pull": {"members": MEMBER.id}},
     {OWNER.id: "owner", ADMIN.id: "admin", MEMBER.id: "admin"}),
]
WRITE_IDS = ["add admin of someone new", "add member of someone new",
             "add admin of a member", "remove an admin", "remove a member",
             "an admin made a member", "a member made an admin"]


@pytest.mark.parametrize("change,query,update,after", WRITES, ids=WRITE_IDS)
def test_a_write_on_a_folded_organization_holds_both_places_and_moves_one_key(
        monkeypatch, accounts, recorded, change, query, update, after):
    stored = install_organizations(monkeypatch, FakeOrganizations(FOLDED))

    change()

    assert the_write(stored) == (query, update)
    assert stored.doc["people"] == after
    assert_one_map(stored.doc)


@pytest.mark.parametrize("change,_query,_update,after", WRITES, ids=WRITE_IDS)
def test_a_write_on_an_unfolded_organization_holds_its_lists_and_folds_it(
        monkeypatch, accounts, recorded, change, _query, _update, after):
    stored = install_organizations(monkeypatch, FakeOrganizations(UNFOLDED))

    change()

    owner = next(user_id for user_id, place in after.items() if place == "owner")
    assert the_write(stored) == (HELD_UNFOLDED, {"$set": {
        "people": after,
        "admins": [u for u, place in after.items() if place == "admin"],
        "members": [u for u, place in after.items() if place == "member"],
        "owner": owner,
    }})
    assert stored.doc["people"] == after
    assert_one_map(stored.doc)


def test_an_unfolded_organization_whose_owner_is_also_listed_is_folded_clean(
        monkeypatch, accounts, recorded):
    # It did not parse on dev; the first change to it folds it, the owner winning, and the
    # mirror drops the owner and the admin listed again from the lists.
    doc = {**UNFOLDED, "admins": [ADMIN.id, OWNER.id], "members": [MEMBER.id, ADMIN.id]}
    stored = install_organizations(monkeypatch, FakeOrganizations(doc))

    OrganizationPeople.add_member(ORG, NEW.email, OWNER.email)

    assert stored.doc["people"] == {OWNER.id: "owner", ADMIN.id: "admin", MEMBER.id: "member",
                                    NEW.id: "member"}
    assert (stored.doc["owner"], stored.doc["admins"], stored.doc["members"]) == (
        OWNER.id, [ADMIN.id], [MEMBER.id, NEW.id])
    assert_one_map(stored.doc)


def test_a_member_listed_as_an_admin_too_is_listed_once_when_made_an_admin(
        monkeypatch, accounts, recorded):
    # A folded organization whose stored lists drifted (a member made an admin before this
    # release stayed in members): the move pulls them from members as it adds them to admins.
    doc = {**FOLDED, "people": {**FOLDED["people"], NEW.id: "member"},
           "admins": [ADMIN.id, NEW.id], "members": [MEMBER.id, NEW.id]}
    stored = install_organizations(monkeypatch, FakeOrganizations(doc))

    OrganizationPeople.add_admin(ORG, NEW.email, OWNER.email)

    assert (stored.doc["admins"], stored.doc["members"]) == ([ADMIN.id, NEW.id], [MEMBER.id])
    assert_one_map(stored.doc)


# ── The account's copy and the history ───────────────────────────────────────────────────────


def test_an_add_copies_the_organization_onto_the_account_and_records_it(stored, recorded):
    OrganizationPeople.add_member(ORG, NEW.email, OWNER.email)

    assert stored.accounts.writes == [({"id": NEW.id}, {"$addToSet": {"organizations": ORG}})]
    [(args, kwargs)] = recorded
    assert args == (ORG, OWNER.email, History.MANAGE_ORGANIZATION_MEMBERS)
    assert kwargs["kind"] == History.ROLE_GIVEN
    assert kwargs["subject"]() == {"user_id": NEW.id, "email": NEW.email}
    assert kwargs["detail"]() == History.changes({"role": None}, {"role": "member"})


def test_a_member_made_an_admin_is_recorded_as_the_place_changed(stored, recorded):
    OrganizationPeople.add_admin(ORG, MEMBER.email, OWNER.email)

    [(args, kwargs)] = recorded
    assert args == (ORG, OWNER.email, History.MANAGE_ORGANIZATION_ADMINS)
    assert kwargs["kind"] == History.ROLE_CHANGED
    assert kwargs["detail"]() == History.changes({"role": "member"}, {"role": "admin"})


@pytest.mark.parametrize("target,place,before", [(ADMIN, "member", "admin"),
                                                 (MEMBER, "admin", "member")],
                         ids=["an admin made a member", "a member made an admin"])
def test_a_place_change_is_recorded_with_the_place_before_and_after(
        stored, recorded, target, place, before):
    OrganizationPeople.change_place(ORG, target.id, place, OWNER.email)

    [(args, kwargs)] = recorded
    assert args == (ORG, OWNER.email, History.MANAGE_ORGANIZATION_ADMINS)
    assert kwargs["kind"] == History.ROLE_CHANGED
    assert kwargs["subject"]() == {"user_id": target.id, "email": target.email}
    assert kwargs["detail"]() == History.changes({"role": before}, {"role": place})
    # They were in the organization before and are after: the account's copy has nothing to do.
    assert stored.accounts.writes == []


def test_a_remove_takes_the_organization_off_the_account_and_records_it(stored, recorded):
    OrganizationPeople.remove(ORG, ADMIN.id, OWNER.email)

    assert stored.accounts.writes == [({"id": ADMIN.id}, {"$pull": {"organizations": ORG}})]
    [(args, kwargs)] = recorded
    assert args == (ORG, OWNER.email, History.MANAGE_ORGANIZATION_ADMINS)
    assert kwargs["kind"] == History.ROLE_TAKEN
    assert kwargs["detail"]() == History.changes({"role": "admin"}, {"role": None})


# ── A write that met a change ────────────────────────────────────────────────────────────────


def deleted(stored):
    return lambda: stored.docs.clear()


def made_admin(stored, person):
    """The owner makes ``person`` an admin, between the other request's read and its write."""
    return lambda: OrganizationPeople.add_admin(ORG, person.email, OWNER.email)


def test_a_write_over_an_organization_deleted_meanwhile_is_a_404(stored, recorded):
    stored.before_write = deleted(stored)

    with pytest.raises(NotFoundError) as refused:
        OrganizationPeople.add_member(ORG, NEW.email, OWNER.email)

    assert refused.value.message == "Organization not found"
    assert recorded == [] and stored.accounts.writes == []


def test_removing_someone_removed_meanwhile_is_the_404_read_as_done(stored, recorded):
    stored.before_write = lambda: OrganizationPeople.remove(ORG, MEMBER.id, OWNER.email)

    with pytest.raises(NotFoundError) as refused:
        OrganizationPeople.remove(ORG, MEMBER.id, ADMIN.email)

    assert refused.value.message == NO_LONGER_IN_THE_ORGANIZATION
    assert MEMBER.id not in places(stored.doc)
    # The one removal that landed is recorded once.
    assert len(recorded) == 1
    assert_one_map(stored.doc)


def test_an_admin_removing_a_member_made_an_admin_meanwhile_is_refused(stored, recorded):
    # The admin judged a member, whom an admin may remove; by the write they are an admin, whom
    # only the owner may. The removal lands on nobody.
    stored.before_write = made_admin(stored, MEMBER)

    with pytest.raises(OrganizationChanged):
        OrganizationPeople.remove(ORG, MEMBER.id, ADMIN.email)

    assert places(stored.doc)[MEMBER.id] == "admin"
    assert_one_map(stored.doc)


def test_an_add_by_an_admin_removed_meanwhile_is_refused(stored, recorded):
    stored.before_write = lambda: OrganizationPeople.remove(ORG, ADMIN.id, OWNER.email)

    with pytest.raises(OrganizationChanged):
        OrganizationPeople.add_member(ORG, NEW.email, ADMIN.email)

    assert NEW.id not in places(stored.doc)
    assert_one_map(stored.doc)


def test_two_adds_of_one_person_land_once(stored, recorded):
    stored.before_write = lambda: OrganizationPeople.add_member(ORG, NEW.email, OWNER.email)

    with pytest.raises(OrganizationChanged):
        OrganizationPeople.add_admin(ORG, NEW.email, OWNER.email)

    assert places(stored.doc)[NEW.id] == "member"
    assert_one_map(stored.doc)


def test_a_place_change_of_someone_removed_meanwhile_is_refused(stored, recorded):
    stored.before_write = lambda: OrganizationPeople.remove(ORG, ADMIN.id, OWNER.email)

    with pytest.raises(OrganizationChanged):
        OrganizationPeople.change_place(ORG, ADMIN.id, "member", OWNER.email)

    assert ADMIN.id not in places(stored.doc)
    assert len(recorded) == 1
    assert_one_map(stored.doc)


def test_two_place_changes_of_one_person_judged_on_one_read_land_once(stored, recorded):
    # Two of the owner's tabs: one makes the admin a member, the other, judged on the same read,
    # makes them a member too. The second meets the first and stores nothing.
    stored.before_write = lambda: OrganizationPeople.change_place(
        ORG, ADMIN.id, "member", OWNER.email)

    with pytest.raises(OrganizationChanged):
        OrganizationPeople.change_place(ORG, ADMIN.id, "member", OWNER.email)

    assert places(stored.doc)[ADMIN.id] == "member"
    assert len(recorded) == 1
    assert_one_map(stored.doc)


def test_a_place_change_by_an_owner_who_handed_the_organization_on_meanwhile_is_refused(
        stored, recorded):
    stored.before_write = lambda: OrgsApi.transfer_org_ownership(ORG, OWNER.email, ADMIN.email)

    with pytest.raises(OrganizationChanged):
        OrganizationPeople.change_place(ORG, MEMBER.id, "admin", OWNER.email)

    assert places(stored.doc)[MEMBER.id] == "member"
    assert_one_map(stored.doc)


def test_the_409_answers_the_sentence_and_its_code(client, stored, recorded):
    stored.before_write = lambda: OrgsApi.transfer_org_ownership(ORG, OWNER.email, NEW.email)

    response = add(client, ADMIN, "members", NEW.email)

    assert (response.status_code, response.get_json()) == (
        409, {"error": ORGANIZATION_CHANGED, "code": "organization_changed"})


# ── Every writer, one organization's life ────────────────────────────────────────────────────


def test_a_new_organizations_map_and_lists_stay_alike_through_every_writer(
        monkeypatch, accounts, recorded):
    stored = install_organizations(monkeypatch, FakeOrganizations())
    monkeypatch.setattr(OrgsApi, "markets_collection", SimpleNamespace(find=lambda *_a: []))

    org_id = OrgsApi.create_organization(OWNER.email, "Ember Markets")
    assert stored.doc["people"] == {OWNER.id: "owner"}

    OrgsApi.add_org_member(org_id, ADMIN.email, OWNER.email)
    OrgsApi.add_org_member(org_id, MEMBER.email, OWNER.email)
    assert_one_map(stored.doc)

    OrgsApi.add_org_admin(org_id, ADMIN.email, OWNER.email)
    assert places(stored.doc) == {OWNER.id: "owner", ADMIN.id: "admin", MEMBER.id: "member"}
    assert_one_map(stored.doc)

    OrgsApi.change_org_place(org_id, ADMIN.id, "member", OWNER.email)
    assert places(stored.doc) == {OWNER.id: "owner", ADMIN.id: "member", MEMBER.id: "member"}
    assert_one_map(stored.doc)

    OrgsApi.change_org_place(org_id, ADMIN.id, "admin", OWNER.email)
    assert places(stored.doc) == {OWNER.id: "owner", ADMIN.id: "admin", MEMBER.id: "member"}
    assert_one_map(stored.doc)

    OrgsApi.remove_org_user(org_id, MEMBER.id, OWNER.email)
    assert places(stored.doc) == {OWNER.id: "owner", ADMIN.id: "admin"}
    assert_one_map(stored.doc)

    OrgsApi.transfer_org_ownership(org_id, OWNER.email, ADMIN.email)
    assert places(stored.doc) == {OWNER.id: "admin", ADMIN.id: "owner"}
    assert_one_map(stored.doc)

    [listed] = OrgsApi.get_organizations_for_user(OWNER.email)
    assert (listed["owner"], listed["admins"], listed["members"]) == (ADMIN.id, [OWNER.id], [])
