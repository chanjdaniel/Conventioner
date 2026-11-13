"""``migrations/migrate_assignment_state.py`` on the server, run as an operator runs it: on the
configured database, through ``write_market``'s held writes, whose conditions on absent and null
keys the hermetic fakes only model.
"""
import copy

from assignment.lifecycle import LEGACY_MADE_FROM
from conftest import stored_assignment, stored_market
from datatypes import MarketPhase
from migrate_assignment_state import migrate

MADE_FROM = {"rules": "r1", "plan": "p1", "applications": "a1", "review": "v1"}


def row(email, hand_placed=False):
    return {
        "email": email, "date": "2026-11-18", "tableCode": "A1", "tableChoice": "Full Table",
        "section": "Gold", "tier": "Gold", "location": "Hall", "handPlaced": hand_placed,
    }


def store(markets, market_id, assignment_object, phase=MarketPhase.ASSIGNMENT, **fields):
    markets.insert_one(stored_market(
        phase, id=market_id, name=f"Fixture {market_id}",
        assignmentObject=assignment_object, **fields))


def assignment_of(markets, market_id):
    return markets.find_one({"id": market_id})["assignmentObject"]


def test_every_market_is_given_its_state_and_a_second_run_changes_nothing(real_db):
    markets = real_db["markets"]
    # Stored before T316: no state, no revision on the oldest.
    store(markets, "legacy-run", {"vendorAssignments": [row("vendor@example.com")]},
          resultsPublished=True)
    store(markets, "pins", {"vendorAssignments": [row("pin@example.com", True)], "revision": 2})
    store(markets, "empty", {"vendorAssignments": []})
    # Written by a rolled-back release over this one's state.
    store(markets, "rolled-back", {
        "vendorAssignments": [row("walk-in@example.com", True)], "state": "none",
        "madeFrom": None, "revision": 3})
    store(markets, "current", stored_assignment(
        "run", rows=[row("run@example.com")], made_from=MADE_FROM, revision=4))
    store(markets, "deleting", {"vendorAssignments": [row("gone@example.com")]},
          deleting={"at": "2026-11-13T00:00:00+00:00", "by": "user-1", "trail_id": "t-1"})
    # Live and archived before T316, published on tables assigned by hand alone (T277's state).
    store(markets, "live-pins", {"vendorAssignments": [row("door@example.com", True)],
                                 "revision": 6}, phase=MarketPhase.MARKET_DAYS,
          resultsPublished=True)
    store(markets, "archived-run", {"vendorAssignments": [row("past@example.com")],
                                    "revision": 1}, phase=MarketPhase.ARCHIVED,
          resultsPublished=True)
    before = list(markets.find({}, {"_id": 0}))

    assert migrate(dry_run=True) == 6
    assert list(markets.find({}, {"_id": 0})) == before

    assert migrate() == 6

    legacy = assignment_of(markets, "legacy-run")
    assert (legacy["state"], legacy["madeFrom"], legacy["publishedRevision"]) == (
        "run", LEGACY_MADE_FROM, 0)
    assert "revision" not in legacy
    assert assignment_of(markets, "pins")["state"] == "pinned"
    assert assignment_of(markets, "pins")["revision"] == 2
    assert assignment_of(markets, "empty")["state"] == "none"
    assert assignment_of(markets, "rolled-back")["state"] == "pinned"
    assert assignment_of(markets, "rolled-back")["madeFrom"] is None
    assert "state" not in assignment_of(markets, "deleting")
    live_pins = assignment_of(markets, "live-pins")
    assert (live_pins["state"], live_pins["publishedRevision"], live_pins["revision"]) == (
        "pinned", 6, 6)
    assert "madeFrom" not in live_pins
    archived = assignment_of(markets, "archived-run")
    assert (archived["state"], archived["madeFrom"], archived["publishedRevision"]) == (
        "run", LEGACY_MADE_FROM, 1)
    assert [m["phase"] for m in markets.find(
        {"id": {"$in": ["live-pins", "archived-run"]}}).sort("id", 1)] == [
        "archived", "market_days"]
    after_first = list(markets.find({}, {"_id": 0}))

    assert migrate() == 0
    assert list(markets.find({}, {"_id": 0})) == after_first


def test_only_the_state_and_its_markers_are_written(real_db):
    markets = real_db["markets"]
    store(markets, "m1", {"vendorAssignments": [row("vendor@example.com")], "revision": 5},
          resultsPublished=True)
    before = markets.find_one({"id": "m1"}, {"_id": 0})

    migrate()

    after = copy.deepcopy(markets.find_one({"id": "m1"}, {"_id": 0}))
    for key in ("state", "madeFrom", "publishedRevision"):
        after["assignmentObject"].pop(key)
    assert after == before
