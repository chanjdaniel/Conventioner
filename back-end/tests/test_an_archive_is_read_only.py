"""An archived market is the record of what happened, so nothing in it can change (bug 30).

E26/F06/S01. On the usage run an archived market still saved a plan date (`PUT /plan` answered
200), and "Free this seat" removed a vendor from a market that had already run. Neither the plan
write nor the placement writes asked the phase; only the solver run did.
"""
from types import SimpleNamespace

import pytest

from conftest import FakeMarketsCollection, sessions_load_through_get_user, stored_market
import app as app_module
import api.market_actions as Actions
import api.markets as MarketsApi
import api.permissions as PermissionsApi
import api.placements as PlacementsApi
import api.users as UsersApi
from client_errors import ForbiddenError
from datatypes import MarketPhase
from guards import VALID_TRANSITIONS

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


def test_the_refusal_is_a_forbidden_error_so_every_route_answers_403():
    """The error handler answers a ``ForbiddenError`` 403 with its own words, on every route."""
    assert issubclass(MarketsApi.MarketArchivedError, ForbiddenError)
    assert MarketsApi.MarketArchivedError.status == 403


@pytest.mark.parametrize("phase", [p for p in MarketPhase if p is not MarketPhase.ARCHIVED])
def test_only_an_archived_market_is_refused_for_being_archived(phase):
    market = MarketsApi.market_from_document(stored_market(phase))

    assert MarketsApi.archived_refusal(market) is None


@pytest.fixture
def client(monkeypatch, archived):
    """The archived market's owner, signed in."""
    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    sessions_load_through_get_user(monkeypatch)
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


class TestTheRoutesThatLoadTheirOwnMarket:
    """Some write routes load the market themselves rather than through the write loader."""

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


#: One write of each row of the table, by its route (E39/F01/S03, from T101's review): an archived
#: market refuses each row outside ``ARCHIVED_STILL_TAKES`` in the archived rule's words, and no row
#: inside it, so the set the screens are served from says what the routes do.
ROW_WRITES = {
    "read": ("get", "/markets/market-123", None),
    "read-history": ("get", "/markets/market-123/history", None),
    "export-csv": ("get", "/markets/market-123/assignment-csv", None),
    "change-setup": ("put", "/markets/market-123/name", {"name": "Another Market"}),
    "change-form": ("put", "/markets/market-123/review-highlights", {"keys": []}),
    "import-applications": ("post", "/markets/market-123/applications/import",
                            {"csvContent": "a,b\n1,2"}),
    "give-verdicts": ("put", "/markets/market-123/applications/app-1/review",
                      {"status": "reviewer_rejected"}),
    "move-phase": ("post", "/markets/market-123/transition", {"toPhase": "draft"}),
    "stop-applications": ("post", "/markets/market-123/applications-stopped", {"stopped": True}),
    "publish-results": ("post", "/markets/market-123/publish-results", {}),
    "add-vendor": ("post", "/markets/market-123/vendors",
                   {"name": "Ana", "email": "ana@example.com"}),
    "write-vendor-notes": ("put", "/markets/market-123/vendor-notes/ana@example.com",
                           {"note": "Extra chair"}),
    "update-vendor-info": ("put", "/markets/market-123/applications/app-1/answers",
                           {"answers": {"business_name": "Ember Ceramics"}}),
    "update-assignment-or-price-info": ("put", "/markets/market-123/applications/app-1/answers",
                                        {"answers": {"essential_max_dates": 1}}),
    "assign": ("post", "/markets/market-123/assignment", None),
    "check-in": ("post", "/markets/market-123/attendance",
                 {"vendorEmail": "ana@example.com", "date": "2026-05-01"}),
    "manage-editors-and-viewers": ("post", "/markets/market-123/roles",
                                   {"user_email": "editor@example.com", "role": "editor"}),
    "manage-admins": ("post", "/markets/market-123/roles",
                      {"user_email": "admin@example.com", "role": "admin"}),
    "delete-market": ("delete", "/markets/market-123", None),
    "change-the-table": ("put", "/markets/market-123/permissions/check-in", {"role": "admin"}),
}

#: A row's other writes, met the same way: resetting one row, or the whole table, is the table's row
#: as setting one is (E39/F01/S04).
MORE_ROW_WRITES = [
    ("change-the-table", ("delete", "/markets/market-123/permissions/check-in", None)),
    ("change-the-table", ("delete", "/markets/market-123/permissions", None)),
]


class TestEveryRowOfTheTable:
    def test_every_row_has_a_write_here(self):
        assert set(ROW_WRITES) == set(Actions.ACTIONS)

    @pytest.mark.parametrize("action_id,write", [*ROW_WRITES.items(), *MORE_ROW_WRITES])
    def test_an_archived_market_refuses_exactly_the_rows_it_does_not_still_take(
        self, client, monkeypatch, action_id, write,
    ):
        # Deleting would reach the market's other collections; only the refusal matters here.
        monkeypatch.setattr(MarketsApi.MarketDeletion, "delete_market_and_records",
                            lambda *_a, **_k: SimpleNamespace(deleted_count=1))
        method, path, body = write

        response = getattr(client, method)(path, json=body)
        answer = (response.get_json(silent=True) or {}).get("error")

        if Actions.ACTIONS[action_id] in MarketsApi.ARCHIVED_STILL_TAKES:
            assert answer != MarketsApi.ARCHIVED_REFUSAL
        elif action_id == Actions.MOVE_PHASE.id:
            # No move leaves archived, so the transition table refuses it before the rule would.
            assert response.status_code == 400
            assert not [move for move in VALID_TRANSITIONS if move[0] == MarketPhase.ARCHIVED.value]
        else:
            assert (response.status_code, answer) == (403, MarketsApi.ARCHIVED_REFUSAL)
