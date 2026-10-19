"""A verdict is written only on what the reviewer saw (E34/F03/S01).

Two reviewers at once: the last verdict silently won. A verdict now carries the status the reviewer
saw, and is written only if the application still has it; otherwise nothing is written and the
reviewer is told who changed it and to what, with the application as it now stands.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import api.applicants as ApplicantsApi  # noqa: E402
import api.applications as ApplicationsApi  # noqa: E402
from conftest import FakeApplicationsCollection  # noqa: E402
from datatypes import ApplicationStatus, VerdictGiver  # noqa: E402

ALEX = VerdictGiver(kind="person", user_id="user-alex", email="alex@market.test")
SAM = VerdictGiver(kind="person", user_id="user-sam", email="sam@market.test")
OPEN_AS_SEEN = {"status": "open", "verdict_at": None}


@pytest.fixture
def stored(monkeypatch):
    fake = FakeApplicationsCollection()
    fake.documents = [{
        "id": "app-1", "market_id": "market-1", "applicant_email": "nadia@ember.test",
        "form_data": {}, "status": "open", "application_type": "main", "submitted_at": None,
        "updated_at": "2026-10-01T00:00:00Z", "verdict_by": None, "verdict_at": None,
    }]
    monkeypatch.setattr(ApplicationsApi, "applications_collection", fake)
    return fake.documents


def test_two_verdicts_on_what_both_saw_the_first_is_written_the_second_refused(stored):
    first, first_status = ApplicantsApi.review_application(
        "market-1", "app-1", ApplicationStatus.REVIEWER_APPROVED, by=ALEX, seen=OPEN_AS_SEEN)
    second, second_status = ApplicantsApi.review_application(
        "market-1", "app-1", ApplicationStatus.REVIEWER_REJECTED, by=SAM, seen=OPEN_AS_SEEN)

    assert first_status == 200
    assert second_status == 409
    assert stored[0]["status"] == "reviewer_approved"
    assert stored[0]["verdict_by"]["email"] == "alex@market.test"
    assert second["error"] == "alex@market.test approved this application since you opened it."
    # As it now stands, so the reviewer can decide again on what is really there.
    assert second["application"]["status"] == "reviewer_approved"
    assert second["application"]["verdictBy"]["email"] == "alex@market.test"


def test_a_verdict_on_what_is_still_there_is_written(stored):
    ApplicantsApi.review_application(
        "market-1", "app-1", ApplicationStatus.REVIEWER_APPROVED, by=ALEX, seen=OPEN_AS_SEEN)
    as_now = {"status": "reviewer_approved", "verdict_at": stored[0]["verdict_at"]}

    _, status = ApplicantsApi.review_application(
        "market-1", "app-1", ApplicationStatus.REVIEWER_REJECTED, by=SAM, seen=as_now)

    assert status == 200
    assert stored[0]["verdict_by"]["email"] == "sam@market.test"


def test_a_change_nobody_gave_is_said_plainly(stored):
    stored[0]["status"] = "needs_follow_up"
    stored[0]["verdict_by"] = {"kind": "rule", "rule": "no_shows"}
    stored[0]["status"] = "reviewer_rejected"

    body, status = ApplicantsApi.review_application(
        "market-1", "app-1", ApplicationStatus.REVIEWER_APPROVED, by=SAM, seen=OPEN_AS_SEEN)

    assert status == 409
    assert body["error"] == "An automatic rejection rejected this application since you opened it."


def test_answers_changed_since_it_was_opened_refuse_the_verdict(stored):
    """An applicant's edit, or a re-import, between opening the card and deciding it."""
    stored[0]["updated_at"] = "2026-10-05T00:00:00Z"
    seen = ApplicantsApi.seen_from(
        {"status": "open", "verdictAt": None, "updatedAt": "2026-10-01T00:00:00Z"})

    body, status = ApplicantsApi.review_application(
        "market-1", "app-1", ApplicationStatus.REVIEWER_APPROVED, by=ALEX, seen=seen)

    assert status == 409
    assert body["error"] == "Its answers changed since you opened it."
    assert stored[0]["status"] == "open"
