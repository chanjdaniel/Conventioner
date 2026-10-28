"""An application can need a follow-up, and someone owns it (E34/F02/S01).

Skip recorded nothing, so an application waiting on its applicant looked like one nobody had
opened. "Needs follow-up" is a stored status: who marked it, and who owns it - the marker unless
reassigned to someone else with a role on the market. It holds Begin Assignment as an undecided
application does, and its applicant sees only that it is under review.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import api.applicants as ApplicantsApi  # noqa: E402
import api.applications as ApplicationsApi  # noqa: E402
from conftest import FakeApplicationsCollection, client_market  # noqa: E402
from client_errors import BadRequestError  # noqa: E402
from datatypes import (  # noqa: E402
    Application, ApplicationStatus, MarketPerson, MarketPhase, VerdictGiver)
from guards import AllApplicationsReviewedGuard  # noqa: E402

ALEX = VerdictGiver(kind="person", user_id="user-alex", email="alex@market.test")
SAM = MarketPerson(user_id="user-sam", email="sam@market.test")


def _app(app_id="app-1", status=ApplicationStatus.OPEN):
    return {"id": app_id, "market_id": "market-1", "applicant_email": f"{app_id}@x.test",
            "form_data": {}, "status": status.value, "application_type": "main",
            "submitted_at": None, "updated_at": "2026-10-01T00:00:00Z"}


@pytest.fixture
def stored(monkeypatch):
    fake = FakeApplicationsCollection()
    fake.documents = [_app()]
    monkeypatch.setattr(ApplicationsApi, "applications_collection", fake)
    return fake.documents


class TestMarkingOne:
    def test_stores_the_status_who_marked_it_and_its_owner_the_marker(self, stored):
        result, status = ApplicantsApi.review_application(
            "market-1", "app-1", ApplicationStatus.NEEDS_FOLLOW_UP, by=ALEX)

        assert status == 200
        assert stored[0]["status"] == "needs_follow_up"
        assert stored[0]["verdict_by"]["email"] == "alex@market.test"
        assert stored[0]["follow_up_owner"] == {"user_id": "user-alex", "email": "alex@market.test"}
        assert result["application"]["followUpOwner"]["email"] == "alex@market.test"

    def test_another_owner_may_be_named_at_once(self, stored):
        ApplicantsApi.review_application(
            "market-1", "app-1", ApplicationStatus.NEEDS_FOLLOW_UP, by=ALEX, owner=SAM)

        assert stored[0]["follow_up_owner"]["email"] == "sam@market.test"

    def test_a_verdict_after_it_clears_the_owner(self, stored):
        ApplicantsApi.review_application(
            "market-1", "app-1", ApplicationStatus.NEEDS_FOLLOW_UP, by=ALEX)

        ApplicantsApi.review_application(
            "market-1", "app-1", ApplicationStatus.REVIEWER_APPROVED, by=ALEX)

        assert "follow_up_owner" not in stored[0]


class TestReassigningIt:
    def test_the_owner_changes(self, stored):
        ApplicantsApi.review_application(
            "market-1", "app-1", ApplicationStatus.NEEDS_FOLLOW_UP, by=ALEX)

        result, status = ApplicantsApi.reassign_follow_up("market-1", "app-1", SAM)

        assert status == 200
        assert stored[0]["follow_up_owner"]["email"] == "sam@market.test"
        assert stored[0]["status"] == "needs_follow_up"

    def test_only_a_follow_up_has_an_owner(self, stored):
        _, status = ApplicantsApi.reassign_follow_up("market-1", "app-1", SAM)

        assert status == 409


class TestItHoldsTheMarket:
    def test_begin_assignment_waits_naming_the_follow_ups(self, monkeypatch):
        counts = {("needs_follow_up",): 2, ("open", "under_review"): 0}
        monkeypatch.setattr(ApplicationsApi, "count_applications_for_market", lambda _id: 5)
        monkeypatch.setattr(ApplicationsApi, "count_applications_with_any_status",
                            lambda _id, statuses: counts[tuple(statuses)])

        result = AllApplicationsReviewedGuard().evaluate(
            client_market(phase=MarketPhase.REVIEW), None)

        assert not result.passed
        assert "2 applications need a follow-up" in result.message


class TestTheApplicant:
    def test_never_reads_it_as_an_outcome(self):
        """Submitted before the results, like everything (E36/F05/S01), and never a verdict after."""
        app = Application(**{**_app(), "status": "needs_follow_up"})
        assert ApplicantsApi._application_response(app, False)["status"] == \
            ApplicationStatus.OPEN.value
        assert ApplicantsApi._application_response(app, True)["status"] == \
            ApplicationStatus.OPEN.value


class TestWhoMayOwnIt:
    def test_a_person_with_a_role_on_the_market(self, monkeypatch):
        import api.markets as MarketsApi
        import api.users as UsersApi
        from types import SimpleNamespace

        people = {"sam@market.test": "user-sam", "stranger@x.test": "user-stranger"}
        monkeypatch.setattr(UsersApi, "get_user", lambda email: SimpleNamespace(
            id=people[email], email=email) if email in people else None)
        market = client_market(roles={"user-owner": "owner", "user-sam": "viewer"})

        requester = MarketPerson(user_id="user-owner", email="owner@market.test")

        assert MarketsApi.follow_up_owner(market, None, requester, "sam@market.test") == SAM
        for email in ("stranger@x.test", "nobody@x.test", None):
            with pytest.raises(BadRequestError, match="must have a role on this market"):
                MarketsApi.follow_up_owner(market, None, requester, email)
