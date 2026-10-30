"""After results are published, an applicant reads one of two outcomes (E36/F05/S02).

"You have a table", with each table and date, or "You did not get assigned" - worked out from the
stored seats on every read, never from the verdict: a rejected vendor seated by hand has a table,
and an approved one whose seat was freed has none. No verdict or reason is ever served.
"""
import pytest

import api.applicants as ApplicantsApi
import result_outcome as ResultOutcome
from datatypes import Application, ApplicationStatus, ApplicationType, VendorAssignmentResult


def application(status=ApplicationStatus.REVIEWER_APPROVED, email="ana@example.com"):
    return Application(
        id="app-1", market_id="market-1", applicant_email=email, form_data={},
        status=status, application_type=ApplicationType.MAIN,
    )


def seat(email, date="2026-11-18", table="A 1"):
    return VendorAssignmentResult(
        email=email, date=date, table_code=table, table_choice="Full Table",
        section="A", tier="Gold", location="North Wing",
    )


PLACED = [seat("ana@example.com"), seat("ana@example.com", "2026-11-19", "A 2"),
          seat("ben@example.com", table="A 3")]


def test_before_publication_there_is_no_outcome():
    served = ApplicantsApi._application_response(application(), False, PLACED)

    assert served["status"] == "open"
    assert served["outcome"] is None
    assert served["seats"] == []


def test_a_seated_applicant_has_a_table_with_each_seat():
    served = ApplicantsApi._application_response(application(), True, PLACED)

    assert served["outcome"] == ResultOutcome.HAS_A_TABLE
    assert served["seats"] == [
        {"date": "2026-11-18", "tableCode": "A 1", "tableChoice": "Full Table",
         "section": "A", "location": "North Wing"},
        {"date": "2026-11-19", "tableCode": "A 2", "tableChoice": "Full Table",
         "section": "A", "location": "North Wing"},
    ]


@pytest.mark.parametrize("status", [
    ApplicationStatus.REVIEWER_APPROVED, ApplicationStatus.REVIEWER_REJECTED,
])
def test_anyone_without_a_seat_did_not_get_assigned_whatever_their_verdict(status):
    served = ApplicantsApi._application_response(
        application(status, email="cy@example.com"), True, PLACED)

    assert served["outcome"] == ResultOutcome.NOT_ASSIGNED
    assert served["seats"] == []


def test_a_rejected_applicant_seated_by_hand_has_a_table():
    served = ApplicantsApi._application_response(
        application(ApplicationStatus.REVIEWER_REJECTED, email="ben@example.com"), True, PLACED)

    assert served["outcome"] == ResultOutcome.HAS_A_TABLE


@pytest.mark.parametrize("status", list(ApplicationStatus))
def test_no_verdict_is_ever_served(status):
    for published in (False, True):
        served = ApplicantsApi._application_response(application(status), published, PLACED)

        assert served["status"] == "open"
        assert not {"verdictBy", "verdictAt", "verdictReason"} & served.keys()
