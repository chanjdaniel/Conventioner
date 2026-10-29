"""An organizer stops taking applications, and takes them again, inside the stage (E38/F04/S02).

Stopping is a fact about the applicant form, not a phase: while stopped, the market's own page
refuses a new application in the words a closed market used, and reviewing goes on. It is offered
only on a market whose vendors apply on its page, only in the stage, and only to an Admin. Moving to
assignment closes the form whether or not it was stopped.
"""
import pytest

from conftest import FakeSlugMarketsCollection

import api.applicants as ApplicantsApi
import db_config as test_db_config
import test_essential_fields as Essential
from datatypes import MarketPhase
from market_documents import market_from_document


def _doc(**overrides):
    """A market whose vendors apply on its page, in the stage, with ``overrides`` stored on it."""
    return {**Essential._applicant_market_doc(), **overrides}


def _install(monkeypatch, doc):
    markets = FakeSlugMarketsCollection(doc)

    class _Db(dict):
        def __getitem__(self, name):
            assert name == "markets"
            return markets

    monkeypatch.setattr(test_db_config, "get_database", lambda *_a, **_kw: _Db())
    return markets


@pytest.fixture
def stopped(monkeypatch):
    return _install(monkeypatch, _doc(applicationsStopped=True))


class TestWhileStopped:
    def test_the_public_form_says_it_is_not_taking_applications(self, stopped):
        body, status = ApplicantsApi.get_public_application_form("test-market")

        assert status == 200
        assert body["is_open"] is False
        assert body["phase_label"] == "Applications Closed"

    def test_a_new_application_is_refused_in_a_closed_markets_words(self, stopped, applications):
        body, status = ApplicantsApi.save_applicant_application(
            "test-market", Essential._token(email="late@example.com"),
            {**Essential.VALID_ANSWERS, "business_name": "Late"},
        )

        assert status == 403
        assert body["error"] == (
            "Applications are no longer open for this market. "
            "The market is in the Applications Closed phase."
        )
        assert applications.find_one({"applicant_email": "late@example.com"}) is None

    def test_a_vendor_who_applied_can_still_read_their_application(self, stopped, applications):
        Essential._seed_application(applications)

        body, status = ApplicantsApi.get_applicant_application("test-market", Essential._token())

        assert status == 200
        assert body["application"]["id"] == "app-1"

    def test_taking_them_again_opens_the_form(self, monkeypatch, applications):
        _install(monkeypatch, _doc(applicationsStopped=False))

        body, status = ApplicantsApi.save_applicant_application(
            "test-market", Essential._token(email="new@example.com"),
            {**Essential.VALID_ANSWERS, "business_name": "New"},
        )

        assert status == 200, body
        assert applications.find_one({"applicant_email": "new@example.com"}) is not None


def test_assignment_closes_the_form_whether_or_not_it_was_stopped(monkeypatch):
    for stopped_now in (False, True):
        _install(monkeypatch, _doc(
            phase=MarketPhase.ASSIGNMENT.value, applicationsStopped=stopped_now,
        ))

        body, _status = ApplicantsApi.get_public_application_form("test-market")

        assert body["is_open"] is False
        assert body["phase_label"] == "Assignment"


class TestTheAction:
    def test_it_is_offered_on_a_form_market_in_the_stage(self):
        market = market_from_document(_doc())

        assert ApplicantsApi.applications_stop_refusal(market) is None

    def test_a_google_form_market_is_not_offered_it(self):
        market = market_from_document(_doc(intakeMode="csv"))

        assert "Google Form" in ApplicantsApi.applications_stop_refusal(market)

    @pytest.mark.parametrize("phase", [MarketPhase.DRAFT, MarketPhase.ASSIGNMENT,
                                       MarketPhase.ARCHIVED])
    def test_outside_the_stage_it_is_not_offered(self, phase):
        market = market_from_document(_doc(phase=phase.value))

        assert ApplicantsApi.applications_stop_refusal(market) is not None

    def test_stopping_writes_the_fact_conditional_on_where_the_market_stands(self, monkeypatch):
        markets = _install(monkeypatch, _doc())

        body, status = ApplicantsApi.set_applications_stopped("market-123", True)

        assert (body, status) == ({"applications_stopped": True}, 200)
        assert markets.last_update == {"$set": {"applicationsStopped": True}}

    def test_a_google_form_market_is_refused_and_nothing_is_written(self, monkeypatch):
        markets = _install(monkeypatch, _doc(intakeMode="csv"))

        _body, status = ApplicantsApi.set_applications_stopped("market-123", True)

        assert status == 409
        assert markets.last_update is None


class TestAStopBelongsToItsStay:
    """Reopen for Editing, then Open Applications, opens applications: a stop made before does not
    leave the form shut (review of T94, finding 2)."""

    def _move(self, monkeypatch, phase, to_phase, stopped=True):
        import api.markets as MarketsApi
        from conftest import FakeMarketsCollection

        markets = FakeMarketsCollection(_doc(phase=phase, applicationsStopped=stopped))
        monkeypatch.setattr(MarketsApi, "markets_collection", markets)
        MarketsApi.apply_phase_transition("market-123", markets.doc, to_phase, by="owner@example.com")
        return markets.last_update["$set"]

    def test_going_back_to_draft_clears_it(self, monkeypatch):
        written = self._move(monkeypatch, MarketPhase.APPLICATIONS.value, MarketPhase.DRAFT.value)

        assert written["applicationsStopped"] is False

    def test_opening_applications_again_clears_it(self, monkeypatch):
        written = self._move(monkeypatch, MarketPhase.DRAFT.value, MarketPhase.APPLICATIONS.value)

        assert written["applicationsStopped"] is False

    def test_entering_assignment_leaves_it_to_the_phase(self, monkeypatch):
        written = self._move(
            monkeypatch, MarketPhase.APPLICATIONS.value, MarketPhase.ASSIGNMENT.value,
        )

        assert "applicationsStopped" not in written
