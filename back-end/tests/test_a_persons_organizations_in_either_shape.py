"""The organizations a person is in are found by one filter, ``organization_people.of_person``, in
either shape an organization is stored in (T283, ADR 0025): by their key in its people map, or, on
one stored before the map, by its owner, admins or members. Nothing else spells that query.
"""
from types import SimpleNamespace

import pytest

from conftest import FakeOrganizations, mongo_matches
import api.organizations as OrgsApi
import api.permissions as PermissionsApi
import api.users as UsersApi
import organization_people as OrganizationPeople

PERSON = SimpleNamespace(id="user-person", email="person@example.com")
OWNER = SimpleNamespace(id="user-owner", email="owner@example.com")


def folded(org_id, people, **lists):
    return {"_id": f"mongo-{org_id}", "id": org_id, "name": org_id, "people": people,
            "markets": [], **lists}


def unfolded(org_id, owner, admins=(), members=()):
    return {"_id": f"mongo-{org_id}", "id": org_id, "name": org_id, "owner": owner,
            "admins": list(admins), "members": list(members), "markets": []}


ORGANIZATIONS = (
    folded("folded-admin", {OWNER.id: "owner", PERSON.id: "admin"},
           owner=OWNER.id, admins=[PERSON.id], members=[]),
    folded("folded-owner", {PERSON.id: "owner"}, owner=PERSON.id, admins=[], members=[]),
    unfolded("unfolded-member", OWNER.id, members=[PERSON.id]),
    unfolded("unfolded-owner", PERSON.id),
    unfolded("unfolded-owner-also-admin", PERSON.id, admins=[PERSON.id]),
    # Not theirs: a folded one whose stale list still names them, and one they were never in.
    folded("folded-stale-list", {OWNER.id: "owner"}, owner=OWNER.id, admins=[PERSON.id]),
    unfolded("someone-elses", OWNER.id, admins=["user-other"]),
)
THEIRS = {"folded-admin", "folded-owner", "unfolded-member", "unfolded-owner",
          "unfolded-owner-also-admin"}


@pytest.mark.parametrize("org", ORGANIZATIONS, ids=lambda org: org["id"])
def test_the_filter_finds_an_organization_by_the_persons_one_place(org):
    assert mongo_matches(org, OrganizationPeople.of_person(PERSON.id)) is (org["id"] in THEIRS)


@pytest.fixture
def stored(monkeypatch):
    collection = FakeOrganizations(*ORGANIZATIONS)
    monkeypatch.setattr(OrgsApi, "organizations_collection", collection)
    monkeypatch.setattr(PermissionsApi, "organizations_collection", collection)
    monkeypatch.setattr(UsersApi, "get_user", {PERSON.email: PERSON, OWNER.email: OWNER}.get)
    return collection


def test_the_markets_list_and_the_organizations_page_find_the_same_organizations(stored):
    assert {org["id"] for org in OrgsApi.organization_documents_of(PERSON.id)} == THEIRS
    assert {org.id for org in PermissionsApi.get_user_organizations(PERSON.email)} == THEIRS
    assert stored.queries == [OrganizationPeople.of_person(PERSON.id)] * 2


@pytest.mark.parametrize("not_an_id", [None, "", 7, "a.b", "$where"])
def test_an_id_unfit_for_a_dotted_path_is_a_programming_error(not_an_id):
    with pytest.raises(RuntimeError):
        OrganizationPeople.of_person(not_an_id)
