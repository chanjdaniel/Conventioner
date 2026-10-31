"""A stored assignment reads with an approved application's answer missing (T139).

The statistics, the tables grid and the CSV read the approved applications through the run's own
check, so one approved application missing an answer the run needs refused all three: on a
published market the Assignments page held its figures with no grid, and the door showed a seat its
drawer could not. A read describes what is stored, so it reads every approved application as it stands; only a
run, which places by those answers, still refuses, with its message unchanged.
"""
import pytest

from conftest import FakeMarketsCollection, stored_market

import api.markets as MarketsApi
import api.permissions as PermissionsApi
import api.placements as PlacementsApi
import essential_fields as EF
from datatypes import MarketPhase, MarketRole

MARKET = "market-123"
OWNER = "owner@market.test"
THU, FRI = "2026-11-19", "2026-11-20"
OPTIONS = {"dates": [THU, FRI], "tiers": ["Gold"], "sections": [], "tableTypes": ["Standard"]}
PLAN = {
    "priority": [],
    "marketDates": [{"date": THU}, {"date": FRI}],
    "tiers": [{"id": 1, "name": "Gold"}],
    "locations": [{"name": "Atrium"}],
    "sections": [
        {"name": "A", "location": {"name": "Atrium"}, "tier": {"id": 1, "name": "Gold"}, "count": 2},
    ],
    "assignmentOptions": {"maxAssignmentsPerVendor": 2, "maxHalfTableProportionPerSection": 50},
}
COMPLETE = {
    EF.FULL_NAME_KEY: "Nadia Okonkwo",
    EF.AVAILABLE_DATES_KEY: [THU, FRI],
    EF.MAX_DATES_KEY: 2,
    EF.TIER_PREFERENCE_KEY: {THU: ["Gold"], FRI: ["Gold"]},
    EF.TABLE_CHOICE_KEY: "full",
}
NADIA, THEO = "nadia@ember.test", "theo@thistle.test"


def _seat(email, date, table):
    return {"email": email, "date": date, "tableCode": table, "tableChoice": "Full Table",
            "section": "A", "tier": "Gold", "location": "Atrium"}


@pytest.fixture
def market(monkeypatch, applications):
    """A market in ``phase`` with Nadia and Theo approved, Theo's dates missing."""
    def at(phase=MarketPhase.MARKET_DAYS, stored=()):
        monkeypatch.setattr(MarketsApi, "markets_collection", FakeMarketsCollection(stored_market(
            phase, setupObject=PLAN,
            applicationForm={"fields": [], "essentialOptions": OPTIONS},
            assignmentObject={"vendorAssignments": list(stored), "assignmentDate": "2026-11-01"})))
        monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_kw: True)
        monkeypatch.setattr(PermissionsApi, "get_user_market_role",
                            lambda *_a, **_kw: MarketRole.OWNER)
        theo = {key: value for key, value in COMPLETE.items() if key != EF.AVAILABLE_DATES_KEY}
        theo[EF.FULL_NAME_KEY] = "Theo Bennett"
        for number, (email, answers) in enumerate([(NADIA, COMPLETE), (THEO, theo)], start=1):
            applications.insert_one({
                "id": f"app-{number}", "market_id": MARKET, "applicant_email": email,
                "form_data": dict(answers), "status": "reviewer_approved",
                "application_type": "main", "submitted_at": f"2026-05-0{number}T09:00:00+00:00",
                "updated_at": f"2026-05-0{number}T09:00:00+00:00",
            })
    return at


SEATED = (_seat(NADIA, THU, "A 1"), _seat(THEO, THU, "A 2"), _seat(THEO, FRI, "A 2"))


class TestAPublishedMarketReadsWhatItStored:
    def test_the_tables_show_every_stored_seat(self, market):
        market(stored=SEATED)

        result, status = MarketsApi.get_market_tables(MARKET, OWNER)

        assert status == 200, result
        seated = {(row["date"], row["tableCode"]): row["assignment"] for row in result["rows"]}
        assert seated[(THU, "A 1")] == [NADIA, NADIA]
        assert seated[(THU, "A 2")] == [THEO, THEO]
        assert seated[(FRI, "A 2")] == [THEO, THEO]
        assert {vendor["email"] for vendor in result["vendors"]} == {NADIA, THEO}

    def test_the_statistics_count_both_approved_vendors_assigned(self, market):
        market(stored=SEATED)

        result, status = MarketsApi.get_assignment_statistics(MARKET, OWNER)

        assert status == 200, result
        assert result["totalVendors"] == 2
        assert result["totalAssignedVendors"] == 2
        assert result["unassignedVendors"] == []

    def test_the_csv_lists_every_stored_seat(self, market):
        market(stored=SEATED)

        result, status = MarketsApi.get_assignment_csv(MARKET, OWNER)

        assert status == 200, result
        rows = result["csv_content"].splitlines()
        assert f"Theo Bennett,Theo Bennett,{THEO},Approved,A 2 - Full Table,A 2 - Full Table" in rows
        assert f"Nadia Okonkwo,Nadia Okonkwo,{NADIA},Approved,A 1 - Full Table," in rows


class TestBeforeAnAssignment:
    def test_the_reads_answer_nobody_placed(self, market):
        market(phase=MarketPhase.APPLICATIONS)

        tables, tables_status = MarketsApi.get_market_tables(MARKET, OWNER)
        stats, stats_status = MarketsApi.get_assignment_statistics(MARKET, OWNER)

        assert (tables_status, stats_status) == (200, 200), (tables, stats)
        assert all(row["assignment"] == [] for row in tables["rows"])
        assert stats["totalAssignedVendors"] == 0
        assert sorted(stats["unassignedVendors"]) == [NADIA, THEO]


class TestARunStillRefuses:
    def test_a_run_names_the_application_missing_its_dates(self, market):
        market(phase=MarketPhase.ASSIGNMENT)

        result, status = PlacementsApi.run_assignment(MARKET, OWNER)

        assert status == 400
        assert result["error"] == (
            "1 approved application cannot be assigned until its answers are complete: "
            f"{THEO} ({EF.AVAILABLE_DATES_LABEL})"
        )
        assert result["incomplete"] == [
            {"applicationId": "app-2", "applicantEmail": THEO,
             "missing": [EF.AVAILABLE_DATES_LABEL]},
        ]

    def test_the_preview_of_a_run_still_refuses(self, market):
        market(phase=MarketPhase.ASSIGNMENT)

        result, status = MarketsApi.get_assigned_market(MARKET, OWNER)

        assert status == 400
        assert "cannot be assigned until its answers are complete" in result["error"]
