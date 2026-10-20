"""A verdict on a selection (E34/F04/S02).

In the All view a reviewer ticks applications and gives one verdict to them. Each is written as a
single verdict is - only on what the reviewer saw (F03/S01) - and one another reviewer holds is not
written at all; the answer says how many were written and, for each skipped, why.
"""
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import api.applicants as ApplicantsApi  # noqa: E402
import api.applications as ApplicationsApi  # noqa: E402
from conftest import FakeApplicationsCollection  # noqa: E402
from datatypes import ApplicationStatus, MarketPerson, VerdictGiver  # noqa: E402

ALEX = VerdictGiver(kind="person", user_id="user-alex", email="alex@market.test")
SAM = MarketPerson(user_id="user-sam", email="sam@market.test")
SEEN_OPEN = {"status": "open", "verdictAt": None}


def _app(app_id, **extra):
    return {"id": app_id, "market_id": "market-1", "applicant_email": f"{app_id}@x.test",
            "form_data": {}, "status": "open", "application_type": "main",
            "submitted_at": None, "updated_at": "2026-10-01T00:00:00Z", "verdict_at": None,
            **extra}


@pytest.fixture
def stored(monkeypatch):
    fake = FakeApplicationsCollection()
    until = (datetime.now(timezone.utc) + timedelta(minutes=3)).isoformat()
    fake.documents = [
        _app("a"),
        _app("b"),
        _app("held", held_by=SAM.model_dump(), held_until=until),
        _app("changed", status="reviewer_rejected", verdict_at="2026-10-02T00:00:00+00:00",
             verdict_by={"kind": "person", "user_id": "user-kai", "email": "kai@market.test"}),
    ]
    monkeypatch.setattr(ApplicationsApi, "applications_collection", fake)
    return {doc["id"]: doc for doc in fake.documents}


def test_each_is_written_as_one_verdict_and_the_rest_skipped_saying_why(stored):
    body, status = ApplicantsApi.review_selection(
        "market-1",
        [(i, ApplicantsApi.seen_from(SEEN_OPEN)) for i in ("a", "b", "held", "changed")],
        ApplicationStatus.REVIEWER_APPROVED, by=ALEX)

    assert status == 200
    assert body["written"] == ["a", "b"]
    assert body["skipped"] == [
        {"id": "held", "email": "held@x.test", "reason": "sam@market.test has it open."},
        {"id": "changed", "email": "changed@x.test",
         "reason": "kai@market.test rejected this application since you opened it."},
    ]
    assert [stored[i]["status"] for i in ("a", "b", "held", "changed")] == [
        "reviewer_approved", "reviewer_approved", "open", "reviewer_rejected"]
    assert stored["a"]["verdict_by"]["email"] == "alex@market.test"


def test_one_the_reviewer_holds_themselves_is_written(stored):
    stored["held"]["held_by"] = {"user_id": "user-alex", "email": "alex@market.test"}

    body, _ = ApplicantsApi.review_selection(
        "market-1", [("held", ApplicantsApi.seen_from(SEEN_OPEN))], ApplicationStatus.REVIEWER_REJECTED,
        by=ALEX)

    assert body["written"] == ["held"]


def test_an_application_of_another_market_is_skipped(stored):
    stored["a"]["market_id"] = "market-2"

    body, _ = ApplicantsApi.review_selection(
        "market-1", [("a", ApplicantsApi.seen_from(SEEN_OPEN))], ApplicationStatus.REVIEWER_APPROVED, by=ALEX)

    assert body["written"] == [] and body["skipped"][0]["reason"] == "Not an application here."


def test_one_already_at_the_status_is_skipped_rather_than_changing_hands(stored):
    stored["a"]["status"] = "needs_follow_up"
    stored["a"]["follow_up_owner"] = {"user_id": "user-sam", "email": "sam@market.test"}

    body, _ = ApplicantsApi.review_selection(
        "market-1", [("a", ApplicantsApi.seen_from({"status": "needs_follow_up"}))],
        ApplicationStatus.NEEDS_FOLLOW_UP, by=ALEX)

    assert body["skipped"][0]["reason"] == "Already needing a follow-up."
    assert stored["a"]["follow_up_owner"]["email"] == "sam@market.test"
