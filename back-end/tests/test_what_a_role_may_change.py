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


@pytest.mark.parametrize("held,publishes", [
    (MarketRole.VIEWER, False),
    (MarketRole.EDITOR, False),
    (MarketRole.ADMIN, True),
    (MarketRole.OWNER, True),
])
def test_the_publish_results_row_alone_says_who_may_publish(role, held, publishes):
    """The Applications page draws Publish Results by its own row, the rule apart (E38/F05)."""
    role(held)

    refused = MarketsApi.publish_results_action_refusal("u@x", market(), None)

    assert (refused is None) is publishes


def test_an_admin_with_nothing_run_may_publish_but_not_yet(role):
    """The row says who; the rule says when, and the screen shows it disabled with why."""
    import api.applicants as ApplicantsApi
    from datatypes import IntakeMode
    role(MarketRole.ADMIN)
    nothing_run = MarketsApi.market_from_document(
        stored_market(MarketPhase.ASSIGNMENT, intakeMode=IntakeMode.FORM.value))

    assert MarketsApi.publish_results_action_refusal("u@x", nothing_run, None) is None
    assert ApplicantsApi.publish_results_refusal(nothing_run).startswith(
        "Run the assignment first")
