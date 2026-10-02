"""An archived market is the record of what happened, so nothing in it can change (bug 30).

E26/F06/S01. On the usage run an archived market still saved a plan date (`PUT /plan` answered
200), and "Free this seat" removed a vendor from a market that had already run. Neither the plan
write nor the placement writes asked the phase; only the solver run did.
"""
from types import SimpleNamespace

import pytest

from conftest import FakeMarketsCollection, stored_market
import app as app_module
import api.form_amendment as Amend
import api.markets as MarketsApi
import api.permissions as PermissionsApi
import api.placements as PlacementsApi
import api.users as UsersApi
from datatypes import MarketPhase

OWNER_EMAIL = "owner@example.com"
FORM = {"fields": [{"key": "name", "label": "Name", "type": "text"}]}


@pytest.fixture
def archived(monkeypatch):
    fake = FakeMarketsCollection(stored_market(MarketPhase.ARCHIVED))
    monkeypatch.setattr(MarketsApi, "markets_collection", fake)
    monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_kw: True)
    return fake


WRITES = {
    "rename": lambda: MarketsApi.rename_market("market-123", "Another Market", "user-1"),
    "plan": lambda: MarketsApi.save_plan("market-123", {"setupObject": {}}, "user-1"),
    "review highlights": lambda: MarketsApi.save_review_highlights("market-123", [], "user-1"),
    "form": lambda: MarketsApi.save_application_form("market-123", FORM, "user-1"),
    "form amendment": lambda: Amend.amend_application_form("market-123", FORM, "user-1"),
    "resume amendment": lambda: Amend.resume_amendment("market-123", "user-1"),
    "assignment run": lambda: PlacementsApi.run_assignment("market-123", "user-1"),
    "place": lambda: PlacementsApi.write_placement(
        "market-123",
        {"email": "a@example.com", "date": "2026-05-01", "table_code": "Hall A 1",
         "table_choice": "Full Table"},
        "user-1",
    ),
    "free a seat": lambda: PlacementsApi.remove_placement(
        "market-123", "a@example.com", "2026-05-01", "user-1"
    ),
    "swap": lambda: PlacementsApi.swap_placements(
        "market-123", "2026-05-01", "a@example.com", "b@example.com", "user-1"
    ),
}


@pytest.mark.parametrize("write", WRITES.values(), ids=WRITES.keys())
def test_every_write_is_refused_and_nothing_is_written(archived, write):
    with pytest.raises(MarketsApi.MarketArchivedError, match="archived"):
        write()

    assert archived.last_update is None


def test_the_refusal_is_a_permission_error_so_every_route_answers_403():
    """Each write route already maps ``PermissionError`` to a 403 carrying its words."""
    assert issubclass(MarketsApi.MarketArchivedError, PermissionError)


@pytest.mark.parametrize("phase", [p for p in MarketPhase if p is not MarketPhase.ARCHIVED])
def test_only_an_archived_market_is_refused_for_being_archived(phase):
    market = MarketsApi.market_from_document(stored_market(phase))

    assert MarketsApi.archived_refusal(market) is None


class TestTheRoutesThatLoadTheirOwnMarket:
    """Some write routes load the market themselves rather than through the write loader."""

    @pytest.fixture
    def client(self, monkeypatch, archived):
        monkeypatch.setattr(app_module.login_manager, "session_protection", None)
        monkeypatch.setattr(
            UsersApi, "get_user",
            lambda email: SimpleNamespace(
                id="user-1", email=email, is_active=True, is_authenticated=True,
                is_anonymous=False, get_id=lambda e=email: e,
            ) if email == OWNER_EMAIL else None,
        )
        client = app_module.app.test_client()
        with client.session_transaction() as session:
            session["_user_id"] = OWNER_EMAIL
            session["_fresh"] = True
        return client

    @pytest.mark.parametrize("method,path,body", [
        ("put", "/markets/market-123/applications/app-1/review", {"status": "reviewer_rejected"}),
        ("post", "/markets/market-123/publish-results", {}),
        ("post", "/markets/market-123/applications/import", {"csvContent": "a,b\n1,2"}),
        ("post", "/markets/market-123/csv-proposal/confirm", {"csvContent": "a,b\n1,2"}),
        ("post", "/floorplans/save-to-market", {"market_id": "market-123", "floorplan": {"a": 1}}),
    ])
    def test_it_is_refused_with_the_same_words(self, client, archived, method, path, body):
        response = getattr(client, method)(path, json=body)

        assert response.status_code == 403
        assert response.get_json()["error"] == MarketsApi.ARCHIVED_REFUSAL
        assert archived.last_update is None
