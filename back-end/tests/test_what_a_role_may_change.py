"""What each person may do to a market, served so the screens agree with the writes (bug 37).

E26/F08/S01. A Viewer was shown every editing control, and each edit appeared to work until its
save failed with a 403. The reasons are asked through the same permission check every write asks.
"""
import pytest

from conftest import stored_market
import api.markets as MarketsApi
import api.permissions as PermissionsApi
from datatypes import MarketPhase, MarketRole

RANK = {MarketRole.VIEWER: 0, MarketRole.EDITOR: 1, MarketRole.ADMIN: 2, MarketRole.OWNER: 3}


@pytest.fixture
def role(monkeypatch):
    def holding(held):
        monkeypatch.setattr(
            PermissionsApi, "user_has_permission",
            lambda _user, _market, needed, _org=None: RANK[held] >= RANK[needed],
        )
    return holding


def market(phase=MarketPhase.ASSIGNMENT):
    return MarketsApi.market_from_document(stored_market(phase))


@pytest.mark.parametrize("held,changes,administers", [
    (MarketRole.VIEWER, False, False),
    (MarketRole.EDITOR, True, False),
    (MarketRole.ADMIN, True, True),
    (MarketRole.OWNER, True, True),
])
def test_each_role_is_told_exactly_what_it_may_not_do(role, held, changes, administers):
    role(held)

    read_only = MarketsApi.change_refusal("u@x", market(), None)
    admin_only = MarketsApi.admin_actions_refusal("u@x", market(), None)

    assert (read_only is None) is changes
    assert (admin_only is None) is administers


def test_a_viewer_is_told_they_can_view_and_who_can_let_them_edit(role):
    role(MarketRole.VIEWER)

    assert "view this market" in MarketsApi.change_refusal("u@x", market(), None)


def test_an_editor_is_told_what_is_for_admins(role):
    role(MarketRole.EDITOR)

    assert MarketsApi.admin_actions_refusal("u@x", market(), None) == MarketsApi.EDITOR_REFUSAL


def test_an_archived_market_is_read_only_whoever_holds_it(role):
    role(MarketRole.OWNER)
    archived = market(MarketPhase.ARCHIVED)

    assert MarketsApi.change_refusal("u@x", archived, None) == MarketsApi.ARCHIVED_REFUSAL
    assert MarketsApi.admin_actions_refusal("u@x", archived, None) == MarketsApi.ARCHIVED_REFUSAL
