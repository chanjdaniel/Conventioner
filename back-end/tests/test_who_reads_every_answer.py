"""Every answer the start kept reaches only someone who may change the form, while it can change
(T213, ADR 0022).

The market keeps, beside a column's common options, every answer the file gave, for an option field
on the Questions tab to offer. It is more of the applicants' words than anyone else has a use for,
so the market read serves it only to a role that passes ``CHANGE_FORM``, while
``application_form_lock_reason`` is None, and no other answer that holds a market carries it: not
the Markets list, nor the two assignment responses that dump the whole market.
"""
from types import SimpleNamespace

import pytest

from conftest import (
    COMPLETE_PLAN, FakeMarketsCollection, FakeSlugMarketsCollection, a_solver_vendor, stored_market,
)
import api.markets as MarketsApi
import api.organizations as OrgsApi
import api.placements as PlacementsApi
import api.users as UsersApi
from datatypes import MarketPhase

MARKET = "market-123"
PEOPLE = {
    "owner@example.com": "user-owner",
    "admin@example.com": "user-admin",
    "editor@example.com": "user-editor",
    "viewer@example.com": "user-viewer",
}
EMAILS = {user_id: email for email, user_id in PEOPLE.items()}
OWNER, ADMIN, EDITOR, VIEWER = PEOPLE
ROLES = {"user-owner": "owner", "user-admin": "admin", "user-editor": "editor",
         "user-viewer": "viewer"}
OPTIONS = {"select": ["Prints"], "multiSelect": ["Prints"]}
ANSWERS = {"select": ["Prints", "Candles"], "multiSelect": ["Prints", "Candles", "Pins"]}


def _column(**overrides):
    return {"headers": ["What do you sell?"], "key": "what_do_you_sell",
            "label": "What do you sell?", "type": "multi_select", "question": True,
            "options": OPTIONS, **overrides}


def _account(email):
    return SimpleNamespace(id=PEOPLE[email], email=email)


@pytest.fixture(autouse=True)
def people(monkeypatch):
    monkeypatch.setattr(
        UsersApi, "get_user", lambda email: _account(email) if email in PEOPLE else None)
    monkeypatch.setattr(
        UsersApi, "get_user_by_id",
        lambda user_id: _account(EMAILS[user_id]) if user_id in EMAILS else None)
    monkeypatch.setattr(UsersApi, "get_users_by_ids", lambda user_ids: {
        user_id: _account(EMAILS[user_id]) for user_id in user_ids if user_id in EMAILS})
    monkeypatch.setattr(OrgsApi, "get_organization", lambda _org_id: None)


@pytest.fixture
def market(monkeypatch):
    """Store a market with a column holding every answer, and answer with its document."""
    def store(phase=MarketPhase.DRAFT, **overrides):
        doc = stored_market(phase, _id="mongo-m1", roles=ROLES,
                            exampleColumns=[_column(answers=ANSWERS)], **overrides)
        monkeypatch.setattr(MarketsApi, "markets_collection", FakeMarketsCollection(doc))
        return doc
    return store


def _columns_read_by(email):
    return MarketsApi.get_market_for_user(email, MARKET)["exampleColumns"]


@pytest.mark.parametrize("email", [OWNER, ADMIN, EDITOR])
def test_who_may_change_an_unlocked_form_is_served_every_answer(market, email):
    market()
    assert _columns_read_by(email) == [_column(answers=ANSWERS)]


def test_a_viewer_is_served_the_column_without_them(market):
    market()
    assert _columns_read_by(VIEWER) == [_column()]


def test_an_editor_is_not_once_an_application_exists(market, applications):
    market()
    applications.count = 1
    assert _columns_read_by(EDITOR) == [_column()]


@pytest.mark.parametrize("phase", [phase for phase in MarketPhase if phase is not MarketPhase.DRAFT])
def test_an_editor_is_not_past_draft(market, phase):
    market(phase)
    assert _columns_read_by(EDITOR) == [_column()]


def test_an_owner_is_not_on_an_archived_market(market):
    market(MarketPhase.ARCHIVED)
    assert _columns_read_by(OWNER) == [_column()]


def test_the_markets_permission_table_decides_the_role(market):
    market(permissions={"change-form": {"role": "admin", "source": "market"}})
    assert _columns_read_by(EDITOR) == [_column()]
    assert _columns_read_by(ADMIN) == [_column(answers=ANSWERS)]


def test_a_table_that_grants_a_viewer_the_form_serves_a_viewer(market):
    market(permissions={"change-form": {"role": "viewer", "source": "market"}})
    assert _columns_read_by(VIEWER) == [_column(answers=ANSWERS)]


def test_a_market_with_no_answers_reads_as_before(market):
    market()
    MarketsApi.markets_collection.doc["exampleColumns"] = [_column()]
    assert _columns_read_by(EDITOR) == [_column()]
    assert _columns_read_by(VIEWER) == [_column()]


def test_a_market_of_no_file_serves_no_columns(market):
    doc = market()
    del doc["exampleColumns"]
    assert "exampleColumns" not in MarketsApi.get_market_for_user(EDITOR, MARKET)


def test_leaving_them_out_never_touches_the_stored_document(market):
    doc = market()
    served = MarketsApi.get_market_for_user(VIEWER, MARKET)
    assert served["exampleColumns"] == [_column()]
    assert doc["exampleColumns"] == [_column(answers=ANSWERS)]


@pytest.mark.parametrize("email", [OWNER, EDITOR, VIEWER])
def test_the_markets_list_never_carries_them(monkeypatch, email):
    doc = stored_market(_id="mongo-m1", roles=ROLES, exampleColumns=[_column(answers=ANSWERS)])
    monkeypatch.setattr(MarketsApi, "markets_collection", FakeSlugMarketsCollection([doc]))
    monkeypatch.setattr(OrgsApi, "get_organizations_for_user", lambda _email: [])

    [listed] = MarketsApi.get_markets_for_user(email)

    assert listed["id"] == MARKET
    assert listed["exampleColumns"] == [_column()]


def _assignable(monkeypatch, module):
    """A market the assignment may run on, whose run hands the market back as it was read."""
    monkeypatch.setattr(module, "solver_vendors_for", lambda _market: [a_solver_vendor()])
    monkeypatch.setattr(module, "assign_market", lambda read, _vendors: read)


def _served_column(payload):
    [column] = payload["exampleColumns"]
    assert column["key"] == "what_do_you_sell"
    return column


@pytest.mark.parametrize("email", [OWNER, VIEWER])
@pytest.mark.parametrize("phase", [MarketPhase.DRAFT, MarketPhase.ASSIGNMENT])
def test_the_assignment_read_never_carries_them(market, monkeypatch, email, phase):
    """It dumps the whole market to anyone who may read it, whatever the phase."""
    market(phase, setupObject=COMPLETE_PLAN)
    _assignable(monkeypatch, MarketsApi)

    payload, status = MarketsApi.get_assigned_market(MARKET, email)

    assert status == 200
    assert "answers" not in _served_column(payload)


def test_running_the_assignment_never_carries_them(market, monkeypatch):
    market(MarketPhase.ASSIGNMENT, setupObject=COMPLETE_PLAN)
    _assignable(monkeypatch, PlacementsApi)
    monkeypatch.setattr(PlacementsApi, "_store_vendor_assignments", lambda *_args: None)
    monkeypatch.setattr(PlacementsApi.History, "record_assignment_run", lambda *_a, **_k: None)
    monkeypatch.setattr(PlacementsApi.PaymentsApi, "seated_again", lambda *_args: None)

    payload, status = PlacementsApi.run_assignment(MARKET, OWNER)

    assert status == 200
    assert "answers" not in _served_column(payload)
