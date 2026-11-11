"""Two role changes at once each land on the person they name, and never undo one another.

Giving, changing and taking a market role each read the market, judge the requester's right and
the person's role, and then write. Each test lands a second role change between that read and the
write (``interleave``), made through its own module function by another organizer, and asserts what a
person and a later reader see: each answer, the roles as stored, and a history whose entries,
replayed over the roles the market started with, give the roles stored.
"""
import pytest

import api.markets as MarketsApi
from api.markets import NO_LONGER_ON_THE_MARKET
from datatypes import MarketPhase, MarketRole
from market_write import MARKET_CHANGED
from real_mongo.test_a_judged_write_lands_only_on_the_market_it_judged import _history, _stored

OWNER = "fixture-owner@example.com"
ADMIN = "fixture-admin@example.com"
EDITOR = "fixture-editor@example.com"
NEWCOMER = "fixture-newcomer@example.com"
CHANGED = {"error": MARKET_CHANGED, "code": "market_changed"}
READ = "api.markets.load_market_context"


@pytest.fixture
def people(signed_in, market_in):
    """An owner, an admin, an editor, and a newcomer with an account and no role, each signed in,
    on a market in Applications holding the first three."""
    owner, admin, editor, newcomer = (signed_in(email) for email in (OWNER, ADMIN, EDITOR, NEWCOMER))
    market = market_in(MarketPhase.APPLICATIONS, roles={
        owner.account_id: "owner", admin.account_id: "admin", editor.account_id: "editor"})
    return market, owner, admin, editor, newcomer


def _take(client, market, person):
    return client.delete(f"/markets/{market['id']}/roles/{person.account_id}")


def _give(client, market, person, role="editor"):
    return client.post(f"/markets/{market['id']}/roles", json={"user_email": person.email, "role": role})


def _change(client, market, person, role):
    return client.put(f"/markets/{market['id']}/roles/{person.account_id}", json={"role": role})


def _gives(by, market, person):
    """Another organizer's add of ``person`` as an Editor, landed by ``interleave``."""
    return lambda: MarketsApi.add_market_role(market["id"], person.email, MarketRole.EDITOR, by.email)


def _takes(by, market, person):
    return lambda: MarketsApi.remove_market_role(market["id"], person.account_id, by.email)


def _changes(by, market, person, role):
    return lambda: MarketsApi.update_market_role(market["id"], person.account_id, role, by.email)


def _replayed(market, market_records):
    """The roles the market started with, with every role entry in its history applied in order."""
    roles = dict(market["roles"])
    for entry in sorted(_history(market_records, market), key=lambda entry: entry["at"]):
        person, after = entry["subject"]["user_id"], entry["detail"]["after"]["role"]
        if after is None:
            roles.pop(person, None)
        else:
            roles[person] = after
    return roles


def _kinds(market_records, market):
    return sorted((entry["kind"], entry["subject"]["email"])
                  for entry in _history(market_records, market))


class TestATakeAndAnAddAtOnce:
    def test_a_take_landing_after_an_add_it_did_not_read_keeps_the_one_added(
            self, people, interleave, real_db, market_records):
        market, owner, admin, editor, newcomer = people
        interleave(READ, _gives(admin, market, newcomer))

        response = _take(owner, market, editor)

        assert response.status_code == 200, response.get_json()
        roles = _stored(real_db, market)["roles"]
        assert editor.account_id not in roles
        assert roles[newcomer.account_id] == "editor"
        assert _kinds(market_records, market) == [("role_given", NEWCOMER), ("role_taken", EDITOR)]
        assert _replayed(market, market_records) == roles

    def test_an_add_landing_after_a_take_it_did_not_read_never_gives_the_role_back(
            self, people, interleave, real_db, market_records):
        market, owner, admin, editor, newcomer = people
        interleave(READ, _takes(owner, market, editor))

        response = _give(admin, market, newcomer)

        assert response.status_code == 200, response.get_json()
        roles = _stored(real_db, market)["roles"]
        assert editor.account_id not in roles
        assert roles[newcomer.account_id] == "editor"
        assert _kinds(market_records, market) == [("role_given", NEWCOMER), ("role_taken", EDITOR)]
        assert _replayed(market, market_records) == roles

    def test_a_change_landing_after_an_add_it_did_not_read_keeps_the_one_added(
            self, people, interleave, real_db, market_records):
        market, owner, admin, editor, newcomer = people
        interleave(READ, _gives(admin, market, newcomer))

        response = _change(owner, market, editor, "viewer")

        assert response.status_code == 200, response.get_json()
        roles = _stored(real_db, market)["roles"]
        assert roles[editor.account_id] == "viewer"
        assert roles[newcomer.account_id] == "editor"
        assert _replayed(market, market_records) == roles


class TestTwoChangesOfOnePerson:
    def test_a_second_take_of_one_person_answers_that_they_no_longer_have_a_role(
            self, people, interleave, real_db, market_records):
        market, owner, admin, editor, _newcomer = people
        interleave(READ, _takes(admin, market, editor))

        response = _take(owner, market, editor)

        assert response.status_code == 404, response.get_json()
        assert response.get_json()["error"] == NO_LONGER_ON_THE_MARKET
        assert editor.account_id not in _stored(real_db, market)["roles"]
        assert _kinds(market_records, market) == [("role_taken", EDITOR)]

    def test_a_change_landing_after_a_take_of_that_person_is_refused(
            self, people, interleave, real_db, market_records):
        market, owner, admin, editor, _newcomer = people
        interleave(READ, _takes(admin, market, editor))

        response = _change(owner, market, editor, "viewer")

        assert response.status_code == 409, response.get_json()
        assert response.get_json() == CHANGED
        assert editor.account_id not in _stored(real_db, market)["roles"]
        assert _kinds(market_records, market) == [("role_taken", EDITOR)]


class TestTheRequestersOwnRole:
    def test_an_add_landing_after_the_requesters_role_changed_is_refused(
            self, people, interleave, real_db, market_records):
        market, owner, admin, _editor, newcomer = people
        interleave(READ, _changes(owner, market, admin, MarketRole.VIEWER))

        response = _give(admin, market, newcomer)

        assert response.status_code == 409, response.get_json()
        assert response.get_json() == CHANGED
        roles = _stored(real_db, market)["roles"]
        assert roles[admin.account_id] == "viewer"
        assert newcomer.account_id not in roles
        assert _kinds(market_records, market) == [("role_changed", ADMIN)]

