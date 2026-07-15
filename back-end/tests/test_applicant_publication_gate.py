"""Tests for the results-publication gate and applicant-visible status.

The captain ruled (2026-07-13):
    - ``reviewer_approved`` / ``reviewer_rejected`` outcomes must stay HIDDEN from the
      applicant until the organizer explicitly PUBLISHES results.
    - Until publication, the applicant sees a neutral ``under_review`` state.
    - After publication, the applicant sees the actual verdict.
    - The organizer always sees the true state.

All three invariants are tested here at the API boundary: the applicant-visible-status function
and the application serialization that wraps it.
"""
import pytest

from unittest.mock import MagicMock
import db_config as test_db_config
from datatypes import (
    Application,
    ApplicationStatus,
    ApplicationType,
    MarketPhase,
)
from api.applicants import (
    _application_response,
    _application_response_organizer,
    applicant_visible_status,
    publish_results,
    list_market_applications,
    review_application,
    REVIEW_IN_PROGRESS_STATUSES,
)
from conftest import FakeApplicationsCollection

import api.applications as ApplicationsApi


# ── applicant_visible_status (pure function) ───────────────────────────────


@pytest.mark.parametrize("status,results_published,expected", [
    (ApplicationStatus.OPEN, False, ApplicationStatus.OPEN),
    (ApplicationStatus.OPEN, True, ApplicationStatus.OPEN),
    (ApplicationStatus.UNDER_REVIEW, False, ApplicationStatus.UNDER_REVIEW),
    (ApplicationStatus.UNDER_REVIEW, True, ApplicationStatus.UNDER_REVIEW),
    (ApplicationStatus.REVIEWER_APPROVED, False, ApplicationStatus.UNDER_REVIEW),
    (ApplicationStatus.REVIEWER_APPROVED, True, ApplicationStatus.REVIEWER_APPROVED),
    (ApplicationStatus.REVIEWER_REJECTED, False, ApplicationStatus.UNDER_REVIEW),
    (ApplicationStatus.REVIEWER_REJECTED, True, ApplicationStatus.REVIEWER_REJECTED),
    (ApplicationStatus.ASSIGNMENT_SENT, False, ApplicationStatus.ASSIGNMENT_SENT),
    (ApplicationStatus.ASSIGNMENT_SENT, True, ApplicationStatus.ASSIGNMENT_SENT),
    (ApplicationStatus.CANCELLED, False, ApplicationStatus.CANCELLED),
    (ApplicationStatus.CANCELLED, True, ApplicationStatus.CANCELLED),
])
def test_applicant_visible_status_gates_by_publication(status, results_published, expected):
    """Every review-working state maps to under_review before publication,
    and reveals the raw verdict after."""
    assert applicant_visible_status(status, results_published) == expected


def test_applicant_visible_status_never_unmasks_without_publication():
    """Proof: every status in the in-progress set reads as under_review when unpublished."""
    for status in REVIEW_IN_PROGRESS_STATUSES:
        assert applicant_visible_status(status, False) == ApplicationStatus.UNDER_REVIEW


def test_applicant_visible_status_reveals_all_with_publication():
    """After publication, every status is returned as-is."""
    for status in REVIEW_IN_PROGRESS_STATUSES:
        assert applicant_visible_status(status, True) == status


# ── _application_response / _application_response_organizer ────────────────


def _app(status: ApplicationStatus = ApplicationStatus.REVIEWER_APPROVED) -> Application:
    return Application(
        id="app-1",
        market_id="market-1",
        applicant_email="vendor@example.com",
        form_data={"shop_name": "Test Shop"},
        status=status,
        application_type=ApplicationType.MAIN,
        submitted_at="2026-07-01T00:00:00Z",
        updated_at="2026-07-02T00:00:00Z",
    )


def test_application_response_hides_verdict_when_unpublished():
    """An unpublished reviewer_approved status reads as under_review."""
    response = _application_response(_app(ApplicationStatus.REVIEWER_APPROVED), False)
    assert response["status"] == ApplicationStatus.UNDER_REVIEW.value


def test_application_response_hides_rejection_when_unpublished():
    """Same gate for rejection."""
    response = _application_response(_app(ApplicationStatus.REVIEWER_REJECTED), False)
    assert response["status"] == ApplicationStatus.UNDER_REVIEW.value


def test_application_response_reveals_verdict_after_publication():
    """After publication, the applicant sees the actual verdict."""
    response = _application_response(_app(ApplicationStatus.REVIEWER_APPROVED), True)
    assert response["status"] == ApplicationStatus.REVIEWER_APPROVED.value


def test_application_response_shows_open_status_regardless():
    """A non-review status such as open is never masked."""
    response = _application_response(_app(ApplicationStatus.OPEN), False)
    assert response["status"] == ApplicationStatus.OPEN.value


def test_application_response_organizer_always_sees_truth():
    """The organizer response never applies the publication gate."""
    response = _application_response_organizer(_app(ApplicationStatus.REVIEWER_APPROVED))
    assert response["status"] == ApplicationStatus.REVIEWER_APPROVED.value

    response = _application_response_organizer(_app(ApplicationStatus.REVIEWER_REJECTED))
    assert response["status"] == ApplicationStatus.REVIEWER_REJECTED.value

    response = _application_response_organizer(_app(ApplicationStatus.UNDER_REVIEW))
    assert response["status"] == ApplicationStatus.UNDER_REVIEW.value


# ── publish_results ────────────────────────────────────────────────────────


class FakeMarketsDb:
    """Simulates the markets collection for the publish-results endpoint."""

    def __init__(self, doc=None):
        self._doc = dict(doc) if doc else {
            "id": "market-1",
            "phase": MarketPhase.APPLICATIONS_CLOSED.value,
            "isDraft": False,
            "resultsPublished": False,
        }
        self.updates = []

    def find_one(self, query, projection=None):
        mid = query.get("id")
        if mid == self._doc.get("id"):
            return dict(self._doc)
        return None

    def update_one(self, query, update):
        self.updates.append((query, update))
        if query.get("id") == self._doc.get("id"):
            self._doc.update(update.get("$set", {}))
        return MagicMock(matched_count=1, modified_count=1)


def test_publish_results_flips_the_flag(monkeypatch):
    fake = FakeMarketsDb()
    monkeypatch.setattr(test_db_config, "get_database", lambda: MagicMock(**{
        "__getitem__": lambda s, k: fake if k == "markets" else MagicMock(),
    }))
    result, status = publish_results("market-1")

    assert status == 200
    assert result["results_published"] is True
    assert fake._doc.get("resultsPublished") is True


def test_publish_results_refuses_when_already_published(monkeypatch):
    fake = FakeMarketsDb({
        "id": "market-1",
        "phase": MarketPhase.APPLICATIONS_CLOSED.value,
        "isDraft": False,
        "resultsPublished": True,
    })
    monkeypatch.setattr(test_db_config, "get_database", lambda: MagicMock(**{
        "__getitem__": lambda s, k: fake if k == "markets" else MagicMock(),
    }))
    result, status = publish_results("market-1")

    assert status == 409
    assert "already published" in result.get("error", "").lower()


def test_publish_results_404_on_missing_market(monkeypatch):
    fake = FakeMarketsDb(None)
    monkeypatch.setattr(test_db_config, "get_database", lambda: MagicMock(**{
        "__getitem__": lambda s, k: fake if k == "markets" else MagicMock(),
    }))
    result, status = publish_results("nonexistent")

    assert status == 404


def test_publish_results_refuses_on_draft_market(monkeypatch):
    fake = FakeMarketsDb({
        "id": "market-1",
        "phase": MarketPhase.DRAFT.value,
        "isDraft": True,
        "resultsPublished": False,
    })
    monkeypatch.setattr(test_db_config, "get_database", lambda: MagicMock(**{
        "__getitem__": lambda s, k: fake if k == "markets" else MagicMock(),
    }))
    result, status = publish_results("market-1")

    assert status == 409
    assert "draft" in result.get("error", "").lower()


# ── list_market_applications (organizer always sees raw status) ─────────────


def test_list_market_applications_returns_raw_statuses(monkeypatch):
    fake = FakeApplicationsCollection()
    fake.documents = [{
        "id": "app-1",
        "market_id": "market-1",
        "applicant_email": "vendor@example.com",
        "form_data": {"shop_name": "Test Shop"},
        "status": ApplicationStatus.REVIEWER_APPROVED.value,
        "application_type": ApplicationType.MAIN.value,
        "main_application_id": None,
        "submitted_at": "2026-07-01T00:00:00Z",
        "updated_at": "2026-07-02T00:00:00Z",
    }]
    monkeypatch.setattr(ApplicationsApi, "applications_collection", fake)

    result, status = list_market_applications("market-1")

    assert status == 200
    apps = result["applications"]
    assert len(apps) == 1
    # Organizer always sees the raw value, never "under_review"
    assert apps[0]["status"] == ApplicationStatus.REVIEWER_APPROVED.value


# ── review_application ─────────────────────────────────────────────────────


def test_review_application_updates_status(monkeypatch):
    fake = FakeApplicationsCollection()
    fake.documents = [{
        "id": "app-1",
        "market_id": "market-1",
        "applicant_email": "vendor@example.com",
        "form_data": {},
        "status": ApplicationStatus.OPEN.value,
        "application_type": ApplicationType.MAIN.value,
        "main_application_id": None,
        "submitted_at": None,
        "updated_at": "2026-07-01T00:00:00Z",
    }]
    monkeypatch.setattr(ApplicationsApi, "applications_collection", fake)

    result, status = review_application(
        "market-1", "app-1", ApplicationStatus.REVIEWER_APPROVED,
    )

    assert status == 200
    assert result["application"]["status"] == ApplicationStatus.REVIEWER_APPROVED.value
    assert fake.documents[0]["status"] == ApplicationStatus.REVIEWER_APPROVED.value


def test_review_application_rejects_invalid_status(monkeypatch):
    fake = FakeApplicationsCollection()
    fake.documents = [{
        "id": "app-1",
        "market_id": "market-1",
        "applicant_email": "vendor@example.com",
        "form_data": {},
        "status": ApplicationStatus.OPEN.value,
        "application_type": ApplicationType.MAIN.value,
        "main_application_id": None,
        "submitted_at": None,
        "updated_at": "2026-07-01T00:00:00Z",
    }]
    monkeypatch.setattr(ApplicationsApi, "applications_collection", fake)

    result, status = review_application(
        "market-1", "app-1", ApplicationStatus.OPEN,
    )
    assert status == 400
    assert "invalid" in result["error"].lower()


def test_review_application_404_on_missing_app(monkeypatch):
    fake = FakeApplicationsCollection()
    monkeypatch.setattr(ApplicationsApi, "applications_collection", fake)

    result, status = review_application(
        "market-1", "nonexistent", ApplicationStatus.REVIEWER_APPROVED,
    )
    assert status == 404


def test_review_application_rejects_app_from_different_market(monkeypatch):
    fake = FakeApplicationsCollection()
    fake.documents = [{
        "id": "app-1",
        "market_id": "market-2",
        "applicant_email": "vendor@example.com",
        "form_data": {},
        "status": ApplicationStatus.OPEN.value,
        "application_type": ApplicationType.MAIN.value,
        "main_application_id": None,
        "submitted_at": None,
        "updated_at": "2026-07-01T00:00:00Z",
    }]
    monkeypatch.setattr(ApplicationsApi, "applications_collection", fake)

    result, status = review_application(
        "market-1", "app-1", ApplicationStatus.REVIEWER_APPROVED,
    )
    assert status == 404
