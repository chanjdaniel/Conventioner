"""Results wait for the allocation (E36/F04/S01, T316).

Publish results is its own button, an admin's. It is available in assignment once a table
allocation has been run and is current, and its confirmation says how many will read each outcome:
a table, or none. Each run here is a real one (``POST /markets/<id>/assignment``, which records
what it was made from), and each change to what it was made from is a real change, so no test
stands on a run the product cannot make.
"""
import pytest

from test_back_to_review import (  # noqa: F401 (world and runs are fixtures)
    DAY, MARKET, _application, _market, runs, world,
)

import assignment.lifecycle as Lifecycle
import result_outcome as ResultOutcome
from conftest import assignment_object, client_market
from datatypes import MarketPhase, VendorAssignmentResult


def _refusal(client):
    """Why Publish results is refused, as the market read serves it beside the button and as the
    endpoint answers it; the two are asserted to agree."""
    served = client.get(f"/markets/{MARKET}").get_json()["market"]["publishWaitsReason"]
    answer = client.post(f"/markets/{MARKET}/publish-results")
    if served is None:
        assert answer.status_code == 200, answer.get_json()
    else:
        assert (answer.status_code, answer.get_json()["error"]) == (409, served)
    return served


def _pin(client, email="vendor@example.com", table=1):
    response = client.put(f"/markets/{MARKET}/placements", json={
        "email": email, "date": DAY, "tableCode": f"Main Hall {table}",
        "tableChoice": "Full Table"})
    assert response.status_code == 200, response.get_json()


def _free(client, email="vendor@example.com"):
    response = client.delete(f"/markets/{MARKET}/placements", json={"email": email, "date": DAY})
    assert response.status_code == 200, response.get_json()


def _approve_another(world):
    world.applications.documents.append(
        {**_application(), "id": "app-2", "applicant_email": "kiln@example.com",
         "form_data": {"shop": "Kiln"}})


@pytest.fixture(params=["form", "csv"])
def intake(request):
    """Both kinds of market: a Google Form market's vendors read their result on its vendor page
    (ADR 0022), so it publishes under the same rule."""
    return request.param


class TestWhenResultsMayBePublished:
    def test_in_assignment_with_a_current_run(self, world, runs, intake):
        world.install(_market(intake=intake))
        runs()

        assert _refusal(world.client) is None

    def test_not_before_the_assignment(self, world, intake):
        world.install(_market(phase=MarketPhase.APPLICATIONS, intake=intake))

        assert _refusal(world.client) == Lifecycle.PUBLISHED_IN_ASSIGNMENT

    def test_not_before_tables_are_allocated(self, world, intake):
        world.install(_market(intake=intake))

        assert _refusal(world.client) == (
            "Allocate tables first: results tell each applicant whether they have a table.")

    def test_not_on_tables_assigned_by_hand_alone(self, world, intake):
        world.install(_market(intake=intake))
        _pin(world.client)

        assert _refusal(world.client) == (
            "Only tables assigned by hand are stored. Allocate tables first: allocating keeps them "
            "and assigns every other approved vendor, so each applicant is told whether they have "
            "a table.")

    def test_on_a_run_edited_by_hand(self, world, runs, intake):
        world.install(_market(intake=intake))
        runs()
        _pin(world.client, table=3)

        assert _refusal(world.client) is None

    def test_not_while_the_run_is_out_of_date(self, world, runs, intake):
        world.install(_market(intake=intake))
        runs()
        _approve_another(world)

        assert _refusal(world.client) == (
            "The table allocation is out of date. Allocate tables again before publishing, so "
            "applicants are told what the market will hold.")

    def test_not_on_a_run_freed_down_to_nobody(self, world, runs, intake):
        markets = world.install(_market(intake=intake))
        runs()
        _free(world.client)
        assert markets.doc["assignmentObject"]["vendorAssignments"] == []

        assert _refusal(world.client) == (
            "Nobody has a table in this allocation, so every applicant would read that they did "
            "not get one. Allocate tables again, or assign tables, before publishing.")

    def test_not_twice(self, world, runs, intake):
        world.install(_market(intake=intake))
        runs()
        assert _refusal(world.client) is None

        assert _refusal(world.client) == "Results are already published."

    def test_publishing_stores_the_revision_it_stood_on(self, world, runs):
        markets = world.install(_market())
        runs()
        stood_on = markets.doc["assignmentObject"]["revision"]

        assert _refusal(world.client) is None

        stored = markets.doc["assignmentObject"]
        assert (stored["revision"], stored["publishedRevision"]) == (stood_on, stood_on)
        served = world.client.get(f"/markets/{MARKET}").get_json()["market"]
        assert served["allocation"] == "published"
        _pin(world.client, table=3)
        served = world.client.get(f"/markets/{MARKET}").get_json()["market"]
        assert served["allocation"] == "changed_since_published"


def _seat(email: str) -> VendorAssignmentResult:
    return VendorAssignmentResult(
        email=email, date="2026-11-18", table_code="A 1", table_choice="Full Table",
        section="A", tier="Gold", location="Main Hall",
    )


class TestWhatEachApplicantWillRead:
    """One of two outcomes, by the stored seats alone (E36/F05/S02): the confirmation counts them."""

    def _market(self, *seated):
        """Seats a run stored; which run does not matter to what an applicant reads."""
        return client_market(
            phase=MarketPhase.ASSIGNMENT,
            assignment_object=assignment_object(
                "run", [_seat(e) for e in seated], made_from=Lifecycle.LEGACY_MADE_FROM),
        )

    def test_a_seat_is_a_table_and_anything_else_is_not(self):
        seated = ResultOutcome.seated_addresses(self._market("Ana@Example.com"))

        assert ResultOutcome.outcome_of("ana@example.com", seated) == ResultOutcome.HAS_A_TABLE
        assert ResultOutcome.outcome_of("ben@example.com", seated) == ResultOutcome.NOT_ASSIGNED

    def test_the_counts_cover_every_main_applicant(self, monkeypatch):
        monkeypatch.setattr(ResultOutcome.ApplicationsApi, "list_applications_for_market", lambda _id: [
            {"applicant_email": "ana@example.com", "application_type": "main"},
            {"applicant_email": "ben@example.com", "application_type": "main"},
            {"applicant_email": "cy@example.com"},
            {"applicant_email": "ana@example.com", "application_type": "waitlist"},
        ])

        assert ResultOutcome.outcome_counts(self._market("ana@example.com")) == {
            "haveATable": 1, "notAssigned": 2}
