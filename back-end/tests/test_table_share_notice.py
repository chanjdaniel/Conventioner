"""A table-share request that pairs nobody is shown to the organizer (E27/F01/S03).

It used to become an ordinary half-table request in silence, so a vendor who asked to sit with a
friend could be seated beside a stranger and nobody would know until market day. The notice is
served on each application the organizer's screens already load, and is derived from the market's
other applications when it is read, never stored: the partner may apply, or be imported, later.
"""
from api.applicants import list_market_applications
from datatypes import ApplicationStatus

MARKET = "market-1"


def application(email, table_choice="half", answer="", address=None, market=MARKET):
    """An application as the write stores it: the words, and the address read out of them."""
    return {
        "id": f"app-{email}",
        "market_id": market,
        "applicant_email": email,
        "form_data": {
            "essential_full_name": "Ana Rivera",
            "essential_table_choice": table_choice,
            "essential_table_share_answer": answer,
            "essential_table_share_email": answer.lower() if address is None else address,
        },
        "status": ApplicationStatus.OPEN.value,
        "application_type": "main",
        "submitted_at": "2026-09-19T16:56:43",
    }


def notices(applications, *docs):
    applications.documents = list(docs)
    result, status = list_market_applications(MARKET)
    assert status == 200
    return {app["applicantEmail"]: app["tableShareNotice"] for app in result["applications"]}


def test_a_request_that_pairs_is_shown_no_notice(applications):
    served = notices(
        applications,
        application("ana@example.com", answer="Share with Bo@Example.com", address="bo@example.com"),
        application("bo@example.com"),
    )

    assert served["ana@example.com"] is None


def test_naming_nobody_is_shown_no_notice(applications):
    assert notices(applications, application("ana@example.com"))["ana@example.com"] is None


def test_an_answer_with_no_address_in_it_says_so(applications):
    served = notices(applications, application("ana@example.com", answer="my friend Bo", address=""))

    assert served["ana@example.com"] == {"reason": "no_address"}


def test_an_address_nobody_applied_as_says_which(applications):
    served = notices(applications, application("ana@example.com", answer="bo@example.com"))

    assert served["ana@example.com"] == {"reason": "no_applicant", "address": "bo@example.com"}


def test_an_applicant_in_another_market_is_nobody_here(applications):
    served = notices(
        applications,
        application("ana@example.com", answer="bo@example.com"),
        application("bo@example.com", market="market-2"),
    )

    assert served["ana@example.com"] == {"reason": "no_applicant", "address": "bo@example.com"}


def test_a_partner_who_wants_a_whole_table_says_so(applications):
    served = notices(
        applications,
        application("ana@example.com", answer="bo@example.com"),
        application("bo@example.com", table_choice="full"),
    )

    assert served["ana@example.com"] == {
        "reason": "partner_wants_full_table", "address": "bo@example.com",
    }


def test_a_partner_who_asked_for_someone_else_says_who_they_asked_for(applications):
    """A person's own request outranks a request about them, so Ana's gives way to Bo's."""
    served = notices(
        applications,
        application("ana@example.com", answer="bo@example.com"),
        application("bo@example.com", answer="cy@example.com"),
        application("cy@example.com"),
    )

    assert served["ana@example.com"] == {
        "reason": "partner_asked_for_someone_else", "address": "bo@example.com",
    }
    assert served["bo@example.com"] is None



def test_the_partner_applying_later_clears_the_notice_with_nothing_else_done(applications):
    """Derived when read, never stored: the partner may apply, or be imported, after the asker."""
    asker = application("ana@example.com", answer="bo@example.com")
    assert notices(applications, asker)["ana@example.com"]["reason"] == "no_applicant"

    assert notices(applications, asker, application("bo@example.com"))["ana@example.com"] is None
