"""The market read tells each person every action's answer (E39/F01/S02).

The screens read five role-shaped reasons from the market read, and each stood for several rows: an
Editor was refused the import in the words of "Move the phase", and every Editor write was offered
on the Market Setup row's answer. The read now serves every row of the table for the person asking,
asked by the same question the writes ask, and each screen offers a control on the answer of the
action it takes. The rules of a market's life that are not the archived one are served beside it,
each on its own.
"""
import re
from pathlib import Path
from types import SimpleNamespace

import pytest

from conftest import stored_market
import api.applicants as ApplicantsApi
import api.market_actions as Actions
import api.markets as MarketsApi
import api.organizations as OrgsApi
import api.permissions as PermissionsApi
import api.users as UsersApi
from datatypes import MarketPhase, MarketRole

USER_ID = "user-1"
USER_EMAIL = "asker@example.com"
FRONT_END_ACTIONS = (
    Path(__file__).resolve().parents[2] / "front-end" / "src" / "utils" / "marketActions.ts"
)

#: Every role a person may hold on a market, and none.
ROLES = [None, MarketRole.VIEWER, MarketRole.EDITOR, MarketRole.ADMIN, MarketRole.OWNER]


class FakeMarketsCollection:
    def __init__(self, doc):
        self.doc = doc

    def find_one(self, query, projection=None):
        return dict(self.doc) if query.get("id") == self.doc["id"] else None


@pytest.fixture
def read(monkeypatch, applications):
    """The market read, for someone holding ``role`` on a market in ``phase``."""
    monkeypatch.setattr(
        UsersApi, "get_user", lambda _email: SimpleNamespace(id=USER_ID, email=USER_EMAIL))
    monkeypatch.setattr(UsersApi, "get_user_by_id", lambda _uid: None)
    monkeypatch.setattr(OrgsApi, "get_organization", lambda _oid: None)

    def serve(role, phase=MarketPhase.REVIEW):
        monkeypatch.setattr(PermissionsApi, "get_user_market_role", lambda *_a, **_k: role)
        monkeypatch.setattr(MarketsApi, "markets_collection", FakeMarketsCollection(
            {**stored_market(phase), "_id": "mongo-market-123"}))
        return MarketsApi.get_market_for_user(USER_EMAIL, "market-123")

    return serve


def market(phase=MarketPhase.REVIEW):
    return MarketsApi.market_from_document(stored_market(phase))


@pytest.mark.parametrize("role", ROLES[1:], ids=str)
def test_the_read_carries_every_rows_answer_as_the_writes_ask_it(read, role):
    served = read(role)["actionRefusals"]

    assert served == {
        row.id: Actions.refusal(row, USER_EMAIL, market(), None)
        for row in Actions.ACTIONS.values()
    }


def test_an_answer_is_none_where_the_person_may_and_the_rows_sentence_where_not(read):
    served = read(MarketRole.EDITOR)["actionRefusals"]

    assert served["change-setup"] is None
    assert served["move-phase"] == "Only an Admin or the owner may move this market's phase."


def test_the_read_asks_the_rows_themselves(read, monkeypatch):
    """A row changed later (E39/F01/S03) reaches the screens: the read asks ``role_refusal`` of
    the role it resolved, as ``refusal`` does."""
    monkeypatch.setattr(Actions, "role_refusal", lambda row, _role: (
        None if row is Actions.CHECK_IN or row is Actions.READ else "No."))

    served = read(MarketRole.VIEWER)["actionRefusals"]

    assert served["check-in"] is None
    assert served["change-setup"] == "No."


def test_the_read_resolves_the_persons_role_once(read, monkeypatch):
    """Resolving it costs a user read; asking each of the table's rows again cost one per row."""
    read(MarketRole.EDITOR)
    resolved = []
    monkeypatch.setattr(PermissionsApi, "get_user_market_role", lambda *_a, **_k: (
        resolved.append(1) or MarketRole.EDITOR))

    MarketsApi.get_market_for_user(USER_EMAIL, "market-123")

    assert len(resolved) == 1


class TestAnArchivedMarket:
    @pytest.mark.parametrize("role", ROLES[1:], ids=str)
    def test_refuses_every_change_in_its_own_words(self, read, role):
        served = read(role, MarketPhase.ARCHIVED)["actionRefusals"]

        for row in Actions.ACTIONS.values():
            if row in MarketsApi.ARCHIVED_STILL_TAKES:
                continue
            assert served[row.id] == MarketsApi.ARCHIVED_REFUSAL, row.id

    def test_still_answers_its_reading_and_its_record_by_the_table(self, read):
        served = read(MarketRole.OWNER, MarketPhase.ARCHIVED)["actionRefusals"]

        assert {row.id for row in MarketsApi.ARCHIVED_STILL_TAKES} == {
            "read", "export-csv", "manage-editors-and-viewers", "manage-admins", "delete-market"}
        assert all(served[row.id] is None for row in MarketsApi.ARCHIVED_STILL_TAKES)


class TestTheReadOnlyLine:
    """The frame says once why a person may change nothing (T15): set when they may take none of
    the table's changing rows, or the market is archived."""

    def test_a_viewer_may_change_nothing(self, read):
        assert read(MarketRole.VIEWER)["readOnlyReason"] == MarketsApi.VIEWER_REFUSAL

    @pytest.mark.parametrize("role", [MarketRole.EDITOR, MarketRole.ADMIN, MarketRole.OWNER])
    def test_anyone_who_may_change_something_is_not_told_so(self, read, role):
        assert read(role)["readOnlyReason"] is None

    @pytest.mark.parametrize("role", ROLES[1:], ids=str)
    def test_an_archived_market_says_so_whoever_holds_it(self, read, role):
        assert read(role, MarketPhase.ARCHIVED)["readOnlyReason"] == MarketsApi.ARCHIVED_REFUSAL

    def test_one_changing_row_is_enough(self, read, monkeypatch):
        monkeypatch.setattr(Actions, "role_refusal", lambda row, _role: (
            None if row in (Actions.READ, Actions.CHECK_IN) else "No."))

        assert read(MarketRole.VIEWER)["readOnlyReason"] is None

    def test_reading_and_exporting_change_nothing(self, read, monkeypatch):
        monkeypatch.setattr(Actions, "role_refusal", lambda row, _role: (
            None if row in (Actions.READ, Actions.EXPORT_CSV) else "No."))

        assert read(MarketRole.VIEWER)["readOnlyReason"] == MarketsApi.VIEWER_REFUSAL


class TestTheRulesOfTheMarketsLifeAreServedOnTheirOwn:
    """Who may is the table's; when is the market's, and each is its own fact on the read."""

    def test_the_verdicts_settle_on_entering_assignment(self, read):
        assert read(MarketRole.OWNER, MarketPhase.REVIEW)["verdictsSettledReason"] is None
        assert read(MarketRole.OWNER, MarketPhase.ASSIGNMENT)["verdictsSettledReason"] == (
            MarketsApi.VERDICTS_SETTLED)

    def test_a_vendor_is_added_from_the_assignment_on(self, read):
        assert read(MarketRole.OWNER, MarketPhase.REVIEW)["addingVendorsReason"] == (
            MarketsApi.NOT_YET_ADDING)
        assert read(MarketRole.OWNER, MarketPhase.ASSIGNMENT)["addingVendorsReason"] is None

    def test_results_wait_for_the_allocation(self, read, monkeypatch):
        monkeypatch.setattr(ApplicantsApi, "publish_results_refusal", lambda _m: "Run it first.")

        assert read(MarketRole.VIEWER)["publishWaitsReason"] == "Run it first."

    def test_the_outcomes_are_counted_only_for_someone_who_may_publish_now(
        self, read, monkeypatch,
    ):
        monkeypatch.setattr(ApplicantsApi, "publish_results_refusal", lambda _m: None)
        monkeypatch.setattr(
            MarketsApi.ResultOutcome, "outcome_counts", lambda _m: {"has_a_table": 2})

        assert read(MarketRole.ADMIN)["publishOutcomes"] == {"has_a_table": 2}
        assert read(MarketRole.EDITOR)["publishOutcomes"] is None


@pytest.mark.parametrize("role", ROLES[1:], ids=str)
def test_no_role_shaped_reason_is_served_any_more(read, role):
    served = read(role)

    for gone in ("adminActionsReason", "verdictLockReason", "addVendorReason",
                 "publishResultsReason"):
        assert gone not in served


class TestTheMarketsList:
    """The list's Manage is offered on the table's answer too, from the role the list already
    resolves from the documents it holds."""

    @pytest.mark.parametrize("role", ROLES, ids=str)
    @pytest.mark.parametrize("phase", [MarketPhase.REVIEW, MarketPhase.ARCHIVED], ids=str)
    def test_an_entry_answers_as_the_market_read(self, read, role, phase):
        served = MarketsApi.role_action_refusals(role, phase)

        if role is None:
            assert all(answer is not None for answer in served.values())
        else:
            assert served == read(role, phase)["actionRefusals"]


def test_the_screens_name_exactly_the_tables_rows():
    """The front end names each row by its id; one it misspelled would hide its control."""
    named = re.findall(r"^\s+\w+: '([a-z-]+)',$", FRONT_END_ACTIONS.read_text(), re.MULTILINE)

    assert named == list(Actions.ACTIONS)
