"""What each person may do to a market, served so the screens agree with the writes (bug 37).

E26/F08/S01. A Viewer was shown every editing control, and each edit appeared to work until its
save failed with a 403. The reasons are asked through the same permission check every write asks.
"""
import pytest

from conftest import stored_market
import api.markets as MarketsApi
import api.permissions as PermissionsApi
from datatypes import MarketPhase, MarketRole


@pytest.fixture
def role(monkeypatch):
    def holding(held):
        monkeypatch.setattr(PermissionsApi, "get_user_market_role", lambda *_a, **_k: held)
    return holding


def market(phase=MarketPhase.ASSIGNMENT):
    return MarketsApi.market_from_document(stored_market(phase))


def told(market_, user="u@x"):
    """Why this person may change nothing here, and what they are told of moving the phase."""
    role = PermissionsApi.get_user_market_role(user, market_, None)
    refusals = MarketsApi.role_action_refusals(role, market_.phase)
    return MarketsApi.read_only_reason(market_, refusals), refusals["move-phase"]


@pytest.mark.parametrize("held,changes,administers", [
    (MarketRole.VIEWER, False, False),
    (MarketRole.EDITOR, True, False),
    (MarketRole.ADMIN, True, True),
    (MarketRole.OWNER, True, True),
])
def test_each_role_is_told_exactly_what_it_may_not_do(role, held, changes, administers):
    role(held)

    read_only, moving = told(market())

    assert (read_only is None) is changes
    assert (moving is None) is administers


def test_a_viewer_is_told_they_can_view_and_who_can_let_them_edit(role):
    role(MarketRole.VIEWER)

    assert "view this market" in told(market())[0]


def test_an_editor_is_told_who_moves_the_phase(role):
    role(MarketRole.EDITOR)

    assert told(market())[1] == "Only an Admin or the owner may move this market's phase."


def test_an_archived_market_is_read_only_whoever_holds_it(role):
    role(MarketRole.OWNER)

    assert told(market(MarketPhase.ARCHIVED)) == (
        MarketsApi.ARCHIVED_REFUSAL, MarketsApi.ARCHIVED_REFUSAL)
