"""Results wait for the allocation (E36/F04/S01).

Publish Results is its own button, an admin's, on a market whose vendors apply on its page. It is
available in assignment once a run is stored and current, and its confirmation says how many will
read each outcome: a table, or none.
"""
import pytest

import api.applicants as ApplicantsApi
import result_outcome as ResultOutcome
from conftest import client_market
from datatypes import (
    AssignmentObject,
    IntakeMode,
    MarketPhase,
    VendorAssignmentResult,
)


def seat(email: str) -> VendorAssignmentResult:
    return VendorAssignmentResult(
        email=email, date="2026-11-18", table_code="A 1", table_choice="Full Table",
        section="A", tier="Gold", location="Main Hall",
    )


def market(phase=MarketPhase.ASSIGNMENT, seated=("ana@example.com",), **overrides):
    return client_market(
        phase=phase,
        intake_mode=overrides.pop("intake_mode", IntakeMode.FORM),
        assignment_object=AssignmentObject(vendor_assignments=[seat(e) for e in seated]),
        **overrides,
    )


@pytest.fixture(autouse=True)
def current(monkeypatch):
    """The stored run is current unless a test says otherwise."""
    monkeypatch.setattr(ApplicantsApi, "changed_since_run", lambda _market: [])


class TestWhenResultsMayBePublished:
    def test_in_assignment_with_a_current_run(self):
        assert ApplicantsApi.publish_results_refusal(market()) is None

    @pytest.mark.parametrize("phase", [
        MarketPhase.APPLICATIONS_OPEN, MarketPhase.APPLICATIONS_CLOSED, MarketPhase.REVIEW,
    ])
    def test_not_before_the_assignment(self, phase):
        assert "assignment" in ApplicantsApi.publish_results_refusal(market(phase=phase))

    def test_not_before_a_run_is_stored(self):
        assert "Run the assignment" in ApplicantsApi.publish_results_refusal(market(seated=()))

    def test_not_while_the_run_is_out_of_date(self, monkeypatch):
        monkeypatch.setattr(ApplicantsApi, "changed_since_run", lambda _market: ["applications"])

        assert "out of date" in ApplicantsApi.publish_results_refusal(market())

    def test_not_twice(self):
        assert "already" in ApplicantsApi.publish_results_refusal(market(results_published=True))

    def test_never_on_a_market_with_no_applicants_to_tell(self):
        refusal = ApplicantsApi.publish_results_refusal(market(intake_mode=IntakeMode.CSV))

        assert "import" in refusal


class TestWhatEachApplicantWillRead:
    """One of two outcomes, by the stored seats alone (E36/F05/S02): the confirmation counts them."""

    def test_a_seat_is_a_table_and_anything_else_is_not(self):
        seated = ResultOutcome.seated_addresses(market(seated=("Ana@Example.com",)))

        assert ResultOutcome.outcome_of("ana@example.com", seated) == ResultOutcome.HAS_A_TABLE
        assert ResultOutcome.outcome_of("ben@example.com", seated) == ResultOutcome.NOT_ASSIGNED

    def test_the_counts_cover_every_main_applicant(self, monkeypatch):
        monkeypatch.setattr(ResultOutcome.ApplicationsApi, "list_applications_for_market", lambda _id: [
            {"applicant_email": "ana@example.com", "application_type": "main"},
            {"applicant_email": "ben@example.com", "application_type": "main"},
            {"applicant_email": "cy@example.com"},
            {"applicant_email": "ana@example.com", "application_type": "waitlist"},
        ])

        assert ResultOutcome.outcome_counts(market()) == {"haveATable": 1, "notAssigned": 2}
