"""A reviewer holds the application they are looking at (E34/F03/S02).

Two reviewers starting together walked the same cards in the same order. Now the next card is the
server's to hand out: the next undecided application nobody else holds, claimed for the reviewer
as it is handed over. A claim is renewed while the card stays open, released on a verdict or on
moving on, and lapses five minutes after its holder stops. It never refuses a verdict.
"""
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import api.applicants as ApplicantsApi  # noqa: E402
import api.applications as ApplicationsApi  # noqa: E402
from conftest import FakeApplicationsCollection  # noqa: E402
from datatypes import Application, ApplicationStatus, MarketPerson, VerdictGiver  # noqa: E402

ALEX = MarketPerson(user_id="user-alex", email="alex@market.test")
SAM = MarketPerson(user_id="user-sam", email="sam@market.test")
NOW = datetime(2026, 10, 20, 12, 0, tzinfo=timezone.utc)


def _app(app_id, submitted_at, status="open"):
    return {"id": app_id, "market_id": "market-1", "applicant_email": f"{app_id}@x.test",
            "form_data": {}, "status": status, "application_type": "main",
            "submitted_at": submitted_at, "updated_at": "2026-10-01T00:00:00Z"}


@pytest.fixture
def stored(monkeypatch):
    fake = FakeApplicationsCollection()
    fake.documents = [
        _app("third", "2026-05-03T00:00:00"),
        _app("first", "2026-05-01T00:00:00"),
        _app("second", "2026-05-02T00:00:00"),
        _app("decided", "2026-04-30T00:00:00", status="reviewer_approved"),
    ]
    monkeypatch.setattr(ApplicationsApi, "applications_collection", fake)
    return {doc["id"]: doc for doc in fake.documents}


def _next(person, after=None, now=NOW, follow_ups=False):
    doc = ApplicationsApi.claim_next_for_review("market-1", person, after, follow_ups, now=now)
    return doc["id"] if doc else None


class TestTwoReviewersWalkDifferentCards:
    def test_pressing_next_together_hands_out_different_applications(self, stored):
        assert _next(ALEX) == "first"
        assert _next(SAM) == "second"
        assert stored["first"]["held_by"] == ALEX.model_dump()

    def test_moving_on_lets_go_of_the_last_card(self, stored):
        _next(ALEX)

        assert _next(ALEX, after="first") == "second"
        assert stored["first"].get("held_by") is None
        assert _next(SAM) == "first"

    def test_the_walk_goes_round_past_cards_others_hold(self, stored):
        _next(ALEX)                       # first
        _next(SAM)                        # second

        assert _next(ALEX, after="first") == "third"
        assert _next(ALEX, after="third") == "first"

    def test_nothing_is_handed_out_when_every_card_is_held(self, stored):
        _next(ALEX)
        _next(SAM)
        _next(MarketPerson(user_id="user-kai", email="kai@market.test"))

        assert _next(MarketPerson(user_id="user-jo", email="jo@market.test")) is None


class TestAClaim:
    def test_lapses_five_minutes_after_its_holder_stops(self, stored):
        _next(ALEX)
        _next(SAM)
        _next(MarketPerson(user_id="user-kai", email="kai@market.test"))

        later = NOW + timedelta(minutes=5, seconds=1)
        assert _next(MarketPerson(user_id="user-jo", email="jo@market.test"), now=later) == "first"

    def test_is_renewed_while_the_card_stays_open(self, stored):
        _next(ALEX)

        assert ApplicationsApi.renew_claim("first", ALEX, now=NOW + timedelta(minutes=4))
        assert _next(SAM, now=NOW + timedelta(minutes=6)) == "second"

    def test_one_that_lapsed_to_someone_else_is_not_renewed(self, stored):
        _next(ALEX)
        later = NOW + timedelta(minutes=6)
        _next(SAM, now=later)

        assert not ApplicationsApi.renew_claim("first", ALEX, now=later)

    def test_is_released_by_a_verdict_and_never_refuses_one(self, stored):
        _next(ALEX)

        _, status = ApplicantsApi.review_application(
            "market-1", "first", ApplicationStatus.REVIEWER_REJECTED,
            by=VerdictGiver(kind="person", user_id="user-sam", email="sam@market.test"))

        assert status == 200
        assert stored["first"].get("held_by") is None

    def test_is_released_on_leaving(self, stored):
        _next(ALEX)

        assert ApplicationsApi.release_claim("first", ALEX)
        assert stored["first"].get("held_by") is None


class TestWhoHoldsItIsShown:
    def test_the_organizer_reads_the_holder_while_the_claim_stands(self, stored):
        _next(ALEX)
        held = Application(**stored["first"])

        assert ApplicantsApi._application_response_organizer(held, now=NOW)["heldBy"] == {
            "email": "alex@market.test", "userId": "user-alex"}
        lapsed = ApplicantsApi._application_response_organizer(
            held, now=NOW + timedelta(minutes=6))
        assert lapsed["heldBy"] is None


class TestOneAskedForByName:
    def test_is_handed_out_first_when_free(self, stored):
        doc = ApplicationsApi.claim_next_for_review(
            "market-1", ALEX, None, False, now=NOW, want="third")

        assert doc["id"] == "third"

    def test_is_not_when_someone_else_holds_it(self, stored):
        _next(SAM)  # first

        doc = ApplicationsApi.claim_next_for_review(
            "market-1", ALEX, None, False, now=NOW, want="first")

        assert doc["id"] == "second"
