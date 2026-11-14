"""Publish results and going live need a table allocation run (T316, T277 ticket 03).

The reproduction, driven through the routes as an organizer and a vendor meet them: in Assignment,
an organizer assigned one approved vendor a table by hand and pressed Publish results, with no
table allocation ever run. The publish was taken, the market went live, and every other approved
vendor read "You did not get assigned" on their vendor page, though nobody decided it: the solver
never ran. Publish results and the move to market days now wait for a run.
"""
import pytest

from conftest import FakeApplicationsCollection, mongo_matches
from test_back_to_review import (  # noqa: F401 (world and runs are fixtures)
    DAY, MARKET, _application, _market, runs, world,
)

import api.applicants as ApplicantsApi
import api.attendance as AttendanceApi

PINNED = "pinned@example.com"
OTHER = "other@example.com"

PINS_ONLY = (
    "Only tables assigned by hand are stored. Allocate tables first: allocating keeps them and "
    "assigns every other approved vendor, so each applicant is told whether they have a table."
)


@pytest.fixture
def market(world, monkeypatch):
    """A form market in Assignment with two approved vendors and a plan, nothing allocated."""
    markets = world.install(_market())
    # The vendor page finds its market by slug, the one read the route world's markets lacks.
    markets.find = lambda query, _projection=None, **_kw: (
        [dict(markets.doc)] if mongo_matches(markets.doc, query or {}) else [])
    world.applications.documents = [
        {**_application(), "id": "app-1", "applicant_email": PINNED},
        {**_application(), "id": "app-2", "applicant_email": OTHER,
         "form_data": {"shop": "Kiln"}},
    ]
    monkeypatch.setattr(AttendanceApi, "attendance_collection", FakeApplicationsCollection())
    monkeypatch.setattr(ApplicantsApi, "authenticate_request",
                        lambda _header: {"market_id": MARKET, "email": OTHER})
    return markets


def _pin(client, email=PINNED, table=1):
    return client.put(f"/markets/{MARKET}/placements", json={
        "email": email, "date": DAY, "tableCode": f"Main Hall {table}",
        "tableChoice": "Full Table"})


def _publish(client):
    return client.post(f"/markets/{MARKET}/publish-results")


def _go_live(client):
    return client.post(f"/markets/{MARKET}/transition", json={"toPhase": "market_days"})


def _the_other_vendors_read(client):
    response = client.get("/public/markets/riverside/applicant/application",
                          headers={"Authorization": "Bearer token"})
    assert response.status_code == 200, response.get_json()
    return response.get_json()["application"]


class TestAMarketWithOnlyATableAssignedByHand:
    def test_is_neither_published_nor_taken_live_and_no_vendor_reads_a_result(
        self, world, market,
    ):
        pinned = _pin(world.client)
        assert pinned.status_code == 200, pinned.get_json()

        published = _publish(world.client)
        live = _go_live(world.client)
        read = _the_other_vendors_read(world.client)

        # One comparison of everything the organizer and the vendor met, so a failure shows it all.
        assert {
            "publish": (published.status_code, published.get_json().get("error")),
            "move": (live.status_code,
                     sorted(b["id"] for b in (live.get_json() or {}).get("blockers", []))),
            "phase": market.doc["phase"],
            "other vendor": (read["status"], read["outcome"]),
        } == {
            "publish": (409, PINS_ONLY),
            "move": (409, ["assignment_computed", "results_published"]),
            "phase": "assignment",
            "other vendor": ("open", None),
        }

    def test_the_market_read_says_why_beside_publish_results(self, world, market):
        assert _pin(world.client).status_code == 200

        served = world.client.get(f"/markets/{MARKET}").get_json()["market"]

        assert served["allocation"] == "pinned"
        assert served["publishWaitsReason"] == PINS_ONLY

    def test_a_run_keeps_the_hand_assignment_and_lets_results_out(self, world, market, runs):
        assert _pin(world.client).status_code == 200
        runs()

        rows = market.doc["assignmentObject"]["vendorAssignments"]
        assert [(row["email"], row["tableCode"], row["handPlaced"]) for row in rows
                if row["email"] == PINNED] == [(PINNED, "Main Hall 1", True)]
        assert OTHER in {row["email"] for row in rows}

        published = _publish(world.client)
        assert published.status_code == 200, published.get_json()
        live = _go_live(world.client)
        assert live.status_code == 200, live.get_json()
        assert _the_other_vendors_read(world.client)["outcome"] == "has_a_table"
