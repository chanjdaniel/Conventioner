"""Who changed a placement, to what, and when (E11/F04/S01).

A placement that differs from what the solver produced is a fact someone will later ask about,
and a flag saying "hand-placed" cannot answer it. Scope is placements and nothing else.
"""
import pytest

from conftest import FakeMarketsCollection, stored_market

import api.markets as MarketsApi
import api.permissions as PermissionsApi
import api.placements as PlacementsApi
import placement_history as PlacementHistory
from datatypes import MarketPhase
from test_the_placement_endpoint import SETUP_OBJECT, placement


class FakeHistoryCollection:
    """Records what was written, and answers a find the way the real query does."""

    def __init__(self):
        self.docs = []
        self.deleted = []

    def insert_one(self, document):
        self.docs.append(document)

    def find(self, query, _projection=None):
        return [
            doc for doc in self.docs
            if doc["market_id"] == query["market_id"]
            and ("vendors" not in query or query["vendors"] in doc["vendors"])
        ]

    def delete_many(self, query):
        gone = [doc for doc in self.docs if doc["market_id"] == query["market_id"]]
        self.docs = [doc for doc in self.docs if doc not in gone]
        self.deleted.append(query["market_id"])
        return type("R", (), {"deleted_count": len(gone)})()


@pytest.fixture
def history(monkeypatch):
    fake = FakeHistoryCollection()
    monkeypatch.setattr(PlacementHistory, "placement_history_collection", fake)
    return fake


@pytest.fixture
def collection(monkeypatch):
    fake = FakeMarketsCollection(
        stored_market(phase=MarketPhase.ASSIGNMENT, setupObject=SETUP_OBJECT)
    )
    monkeypatch.setattr(MarketsApi, "markets_collection", fake)
    monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_k: True)
    return fake


def seat(collection, email, date, table_code, choice="Full Table"):
    collection.doc["assignmentObject"]["vendorAssignments"].append({
        "email": email, "date": date, "tableCode": table_code, "tableChoice": choice,
        "section": "Hall A", "tier": "Gold", "location": "Main Hall", "handPlaced": True,
    })


class TestOneEntryPerAction:
    def test_a_hand_placement_writes_one_entry(self, collection, history):
        PlacementsApi.write_placement("market-123", placement(), "organizer@example.com")

        assert len(history.docs) == 1
        entry = history.docs[0]
        assert entry["kind"] == PlacementHistory.PLACED
        assert entry["actor"] == "organizer@example.com"
        assert entry["vendors"] == ["ana@example.com"]
        assert entry["detail"]["table_code"] == "Hall A 1"
        assert entry["at"]

    def test_a_swap_writes_one_entry_not_two(self, collection, history):
        """It was one action. Two rows would read as two unrelated decisions a week later."""
        seat(collection, "ana@example.com", "2026-08-01", "Hall A 1")
        seat(collection, "ben@example.com", "2026-08-01", "Hall A 2")

        PlacementsApi.swap_placements(
            "market-123", "2026-08-01", "ana@example.com", "ben@example.com", "organizer@x.test"
        )

        assert len(history.docs) == 1
        entry = history.docs[0]
        assert entry["kind"] == PlacementHistory.SWAPPED
        assert sorted(entry["vendors"]) == ["ana@example.com", "ben@example.com"]

    def test_freeing_a_seat_writes_one_entry(self, collection, history):
        """Recorded even though nobody was placed: this is what a vendor dropping out looks like."""
        seat(collection, "ana@example.com", "2026-08-01", "Hall A 1")

        PlacementsApi.remove_placement(
            "market-123", "ana@example.com", "2026-08-01", "organizer@x.test"
        )

        assert [doc["kind"] for doc in history.docs] == [PlacementHistory.FREED]
        assert history.docs[0]["detail"]["table_code"] == "Hall A 1"

    def test_freeing_a_seat_nobody_holds_writes_nothing(self, collection, history):
        PlacementsApi.remove_placement(
            "market-123", "nobody@example.com", "2026-08-01", "organizer@x.test"
        )

        assert history.docs == []

    def test_a_solver_run_writes_one_entry_naming_what_it_touched(
        self, collection, history, monkeypatch
    ):
        """Not one per placement: that would drown the hand edits under machine rows, and the
        hand edits are the entries anyone actually reads."""
        from datatypes import AssignmentObject, VendorAssignmentResult

        def rows(market, _vendors=None):
            market.assignment_object = AssignmentObject(
                vendor_assignments=[
                    VendorAssignmentResult(
                        email=f"v{i}@example.com", date="2026-08-01", table_code=f"Hall A {i}",
                        table_choice="Full Table", section="Hall A", tier="Gold",
                        location="Main Hall", hand_placed=(i == 1),
                    )
                    for i in (1, 2)
                ],
                assignment_date="2026-07-01T00:00:00",
            )
            return market

        monkeypatch.setattr(PlacementsApi, "solver_vendors_for", lambda _m: ["a vendor"])
        monkeypatch.setattr(PlacementsApi, "assign_market", rows)

        PlacementsApi.run_assignment("market-123", "dana@example.com")

        assert len(history.docs) == 1
        entry = history.docs[0]
        assert entry["kind"] == PlacementHistory.ASSIGNED
        assert entry["actor"] == "dana@example.com"
        assert entry["detail"] == {"placements_written": 2, "pins_preserved": 1}


class TestReadingTheTrail:
    def test_the_market_shows_all_of_them(self, collection, history):
        PlacementsApi.write_placement("market-123", placement(), "organizer@x.test")
        PlacementsApi.write_placement(
            "market-123", placement(email="ben@example.com", table_code="Hall A 2"),
            "organizer@x.test",
        )

        entries = PlacementHistory.entries_for_market("market-123")

        assert len(entries) == 2

    def test_a_vendors_panel_shows_only_theirs(self, collection, history):
        PlacementsApi.write_placement("market-123", placement(), "organizer@x.test")
        PlacementsApi.write_placement(
            "market-123", placement(email="ben@example.com", table_code="Hall A 2"),
            "organizer@x.test",
        )

        entries = PlacementHistory.entries_for_market("market-123", "ben@example.com")

        assert [entry["vendors"] for entry in entries] == [["ben@example.com"]]

    def test_an_address_is_matched_whatever_its_case(self, collection, history):
        PlacementsApi.write_placement(
            "market-123", placement(email="Ana@Example.com"), "organizer@x.test"
        )

        assert PlacementHistory.entries_for_market("market-123", "ANA@EXAMPLE.COM")

    def test_the_newest_entry_comes_first(self, history):
        PlacementHistory.record_freed("m", "a@x.test", "v@x.test", "2026-08-01", "A 1")
        PlacementHistory.record_freed("m", "a@x.test", "v@x.test", "2026-08-01", "A 2")
        history.docs[0]["at"] = "2020-01-01T00:00:00+00:00"
        history.docs[1]["at"] = "2026-01-01T00:00:00+00:00"

        assert [e["detail"]["table_code"] for e in PlacementHistory.entries_for_market("m")] == [
            "A 2", "A 1",
        ]

    def test_another_markets_entries_are_not_in_this_ones_trail(self, history):
        PlacementHistory.record_freed("m1", "a@x.test", "v@x.test", "2026-08-01", "A 1")
        PlacementHistory.record_freed("m2", "a@x.test", "v@x.test", "2026-08-01", "A 1")

        assert len(PlacementHistory.entries_for_market("m1")) == 1


class TestTheTrailIsKeptWithTheMarket:
    def test_deleting_a_market_takes_its_history_with_it(self, history):
        PlacementHistory.record_freed("m1", "a@x.test", "v@x.test", "2026-08-01", "A 1")
        PlacementHistory.record_freed("m2", "a@x.test", "v@x.test", "2026-08-01", "A 1")

        gone = PlacementHistory.delete_for_market("m1")

        assert gone == 1
        assert PlacementHistory.entries_for_market("m1") == []
        assert len(PlacementHistory.entries_for_market("m2")) == 1


def test_a_trail_that_cannot_be_written_does_not_break_the_placement(collection, monkeypatch):
    """The seat is already taken by the time this runs, and check-in will read it. Failing the
    request because the RECORD could not be saved would say the change did not land when it did.
    """
    class Broken:
        def insert_one(self, _doc):
            raise RuntimeError("mongo is having a day")

    monkeypatch.setattr(PlacementHistory, "placement_history_collection", Broken())

    _result, status = PlacementsApi.write_placement("market-123", placement(), "organizer@x.test")

    assert status == 200


def test_deleting_a_market_deletes_its_trail_through_the_endpoint(monkeypatch, history):
    """The trail names the organizers who made each change, so it must not outlive the market."""
    from datatypes import MarketRole

    fake = FakeMarketsCollection(stored_market())
    monkeypatch.setattr(MarketsApi, "markets_collection", fake)
    monkeypatch.setattr(
        MarketsApi.PermissionsApi, "get_user_market_role", lambda *_a, **_k: MarketRole.OWNER
    )
    PlacementHistory.record_freed("market-123", "a@x.test", "v@x.test", "2026-08-01", "A 1")

    MarketsApi.delete_market("market-123", "owner@example.com")

    assert PlacementHistory.entries_for_market("market-123") == []
