"""The assignment stores its state, and one owner writes it (T316).

Where the assignment stood was read off its rows, their hand-placed flags, ``madeFrom``,
``resultsPublished`` and the phase, so a market holding only tables assigned by hand read like one
whose tables were allocated. ``assignment.lifecycle`` stores ``none``, ``pinned`` or ``run`` beside
the rows on every write, reads it back only while it agrees with them, and serves where the table
allocation stands as ``allocation``.
"""
import copy
import logging
from types import SimpleNamespace

import pytest

from conftest import (
    FakeMarketsCollection, a_solver_vendor, assignment_object, stored_assignment, stored_market,
)

import api.markets as MarketsApi
import api.organizations as OrgsApi
import api.permissions as PermissionsApi
import api.placements as PlacementsApi
import api.users as UsersApi
import assignment.lifecycle as Lifecycle
import assignment.made_from as MadeFrom
from assignment.utils import convert_keys_to_snake_case
from datatypes import (
    AssignmentObject, AssignmentState, MarketPhase, MarketRole, PhaseEntry, SetupObject,
    VendorAssignmentResult,
)
from market_documents import market_from_document
import market_write as MarketWrite

NONE, PINNED, RUN = AssignmentState.NONE, AssignmentState.PINNED, AssignmentState.RUN
PLACE, FREE, RUN_EVENT = Lifecycle.Event.PLACE, Lifecycle.Event.FREE, Lifecycle.Event.RUN
A = Lifecycle.Allocation

DAY = "2026-08-01"
PLAN = {
    "priority": [],
    "marketDates": [{"date": DAY}],
    "tiers": [{"id": 1, "name": "Gold"}],
    "locations": [{"name": "Main Hall"}],
    "sections": [{"name": "Hall A", "location": {"name": "Main Hall"},
                  "tier": {"id": 1, "name": "Gold"}, "count": 3}],
    "assignmentOptions": {"maxAssignmentsPerVendor": 1, "maxHalfTableProportionPerSection": 50},
}
#: The phases a market at Assignment has been through: in the review stage once.
REVIEWED_ONCE = ("draft", "applications", "assignment")


def row(email="ana@example.com", table="Hall A 1", hand_placed=True) -> dict:
    return {"email": email, "date": DAY, "tableCode": table, "tableChoice": "Full Table",
            "section": "Hall A", "tier": "Gold", "location": "Main Hall",
            "handPlaced": hand_placed}


def history(*phases) -> list:
    return [{"phase": phase, "enteredAt": "2026-01-01T00:00:00Z"} for phase in phases]


def made_from(plan=PLAN, phases=REVIEWED_ONCE) -> dict:
    """What a run over ``plan`` and no approved application, after ``phases``, records."""
    return MadeFrom.fingerprint(
        SetupObject(**convert_keys_to_snake_case(plan)), [],
        [PhaseEntry(phase=phase, entered_at="2026-01-01T00:00:00Z") for phase in phases])


def raw_assignment(state=None, rows=(), made_from_=None) -> AssignmentObject:
    """An assignment object as any release may have stored it, contradictions included."""
    return AssignmentObject(
        vendor_assignments=[VendorAssignmentResult(**convert_keys_to_snake_case(r)) for r in rows],
        made_from=made_from_, state=state)


# --- The derivation rule ------------------------------------------------------------------------


@pytest.mark.parametrize("rows, made_from_, state, recorded", [
    ((), None, NONE, None),
    ((row(), row("ben@example.com", "Hall A 2")), None, PINNED, None),
    ((row(), row("ben@example.com", "Hall A 2", hand_placed=False)), None, RUN,
     Lifecycle.LEGACY_MADE_FROM),
    ((row(hand_placed=False),), {"rules": "r"}, RUN, {"rules": "r"}),
], ids=["nothing", "only hand placements", "a run before fingerprints", "a recorded run"])
def test_the_rows_and_made_from_give_one_state(rows, made_from_, state, recorded):
    assert Lifecycle.derived_state(raw_assignment(rows=rows, made_from_=made_from_)) == (
        Lifecycle.Derived(state, recorded))


def test_a_run_freed_to_no_row_is_still_derived_a_run():
    assert Lifecycle.derived_state(raw_assignment(made_from_={"rules": "r"})).state is RUN


def test_the_legacy_marker_is_never_out_of_date():
    """It holds no group, so it reads as a run before fingerprints always has: not known to have
    changed, so no market's allocation reads as out of date for it."""
    assert not set(Lifecycle.LEGACY_MADE_FROM) & set(MadeFrom.GROUPS)


# --- state_of -----------------------------------------------------------------------------------


@pytest.mark.parametrize("rows, made_from_, state", [
    ((), None, NONE),
    ((row(),), None, PINNED),
    ((row(hand_placed=False),), {"rules": "r"}, RUN),
    ((), {"rules": "r"}, RUN),
], ids=["none", "pinned", "run", "run freed to no row"])
def test_a_stored_state_that_agrees_is_read_as_stored_without_a_word(
        caplog, rows, made_from_, state):
    with caplog.at_level(logging.WARNING, logger=Lifecycle.__name__):
        assert Lifecycle.state_of(
            raw_assignment(state, rows, made_from_), "market-123") is state
    assert caplog.records == []


@pytest.mark.parametrize("rows, made_from_, derived", [
    ((), None, NONE),
    ((row(),), None, PINNED),
    ((row(hand_placed=False),), None, RUN),
    ((row(hand_placed=False),), {"rules": "r"}, RUN),
], ids=["none", "pinned", "a run before fingerprints", "a recorded run"])
def test_an_absent_state_is_derived_without_a_word(caplog, rows, made_from_, derived):
    """A market no write or migration has given a state yet, or a raw seed."""
    with caplog.at_level(logging.WARNING, logger=Lifecycle.__name__):
        assert Lifecycle.state_of(raw_assignment(None, rows, made_from_), "market-123") is derived
    assert caplog.records == []


@pytest.mark.parametrize("stored, rows, made_from_, derived", [
    (NONE, (row(),), None, PINNED),
    (NONE, (row(hand_placed=False),), {"rules": "r"}, RUN),
    (NONE, (), {"rules": "r"}, RUN),
    (PINNED, (), None, NONE),
    (PINNED, (row(),), {"rules": "r"}, RUN),
    (RUN, (), None, NONE),
    (RUN, (row(),), None, PINNED),
], ids=[
    "none, with a hand placement",
    "none, with a run",
    "none, with a run freed to no row",
    "pinned, with nothing",
    "pinned, with a run",
    "run, with nothing",
    "run, with only a hand placement and no made_from",
])
def test_a_stored_state_that_disagrees_is_read_as_derived_and_logged_by_market_id(
        caplog, stored, rows, made_from_, derived):
    """What a rolled-back release's write leaves: it writes the rows and never the state."""
    with caplog.at_level(logging.WARNING, logger=Lifecycle.__name__):
        assert Lifecycle.state_of(raw_assignment(stored, rows, made_from_), "market-123") is derived
    [warning] = caplog.records
    said = warning.getMessage()
    assert "market-123" in said and stored.value in said and derived.value in said
    assert "@" not in said


def test_a_state_this_build_does_not_know_reads_as_absent():
    """A later release's state, read after a rollback, never fails the market's read."""
    parsed = AssignmentObject(**{"vendor_assignments": [], "state": "allocated-twice"})
    assert parsed.state is None
    assert Lifecycle.state_of(parsed, "market-123") is NONE


# --- next_state ---------------------------------------------------------------------------------


ONE_ROW = [VendorAssignmentResult(**convert_keys_to_snake_case(row()))]


@pytest.mark.parametrize("state, event, rows_after, after", [
    (NONE, PLACE, ONE_ROW, PINNED),
    (PINNED, PLACE, ONE_ROW, PINNED),
    (RUN, PLACE, ONE_ROW, RUN),
    (NONE, FREE, [], NONE),
    (PINNED, FREE, ONE_ROW, PINNED),
    (PINNED, FREE, [], NONE),
    (RUN, FREE, ONE_ROW, RUN),
    (RUN, FREE, [], RUN),
    (NONE, RUN_EVENT, ONE_ROW, RUN),
    (PINNED, RUN_EVENT, ONE_ROW, RUN),
    (RUN, RUN_EVENT, ONE_ROW, RUN),
    (RUN, RUN_EVENT, [], RUN),
])
def test_every_state_and_event_has_one_next_state(state, event, rows_after, after):
    assert Lifecycle.next_state(state, event, rows_after) is after


def test_every_state_and_event_is_covered_above():
    covered = {(state, event) for state, event, _rows, _after in
               test_every_state_and_event_has_one_next_state.pytestmark[0].args[1]}
    assert covered == {(state, event) for state in AssignmentState for event in Lifecycle.Event}


# --- allocation ---------------------------------------------------------------------------------


def market(phase=MarketPhase.ASSIGNMENT, assignment=None, phases=REVIEWED_ONCE, **fields):
    return market_from_document(stored_market(
        phase, setupObject=PLAN, phaseHistory=history(*phases),
        assignmentObject=assignment or stored_assignment("none"), **fields))


def a_run(**kwargs) -> dict:
    return stored_assignment("run", [row(hand_placed=False)], made_from=made_from(**kwargs))


#: A run made before the plan gained a section: out of date by the plan group.
PLAN_CHANGED = {"plan": {**PLAN, "sections": [{**PLAN["sections"][0], "count": 2}]}}
#: A market that went Back to review after the run and began assignment again: out of date by
#: the review group.
BACK_AND_ASSIGNED = ("draft", "applications", "assignment", "applications", "assignment")


def test_nothing_stored_is_none_and_hand_placements_only_are_pinned():
    assert Lifecycle.allocation(market()) is A.NONE
    assert Lifecycle.allocation(market(assignment=stored_assignment("pinned", [row()]))) is (
        A.PINNED)


def test_a_run_nothing_has_changed_since_is_current():
    assert Lifecycle.allocation(market(assignment=a_run())) is A.CURRENT


def test_in_assignment_a_run_is_stale_by_any_group():
    assert Lifecycle.allocation(market(assignment=a_run(**PLAN_CHANGED))) is A.STALE
    assert Lifecycle.allocation(market(assignment=a_run(), phases=BACK_AND_ASSIGNED)) is A.STALE


def test_in_assignment_the_groups_the_read_computed_are_used_and_not_read_again(monkeypatch):
    monkeypatch.setattr(Lifecycle, "changed_since_run", lambda _market: pytest.fail("read again"))
    assert Lifecycle.allocation(market(assignment=a_run()), changed=["rules"]) is A.STALE
    assert Lifecycle.allocation(market(assignment=a_run(**PLAN_CHANGED)), changed=[]) is (
        A.CURRENT)


def test_in_the_review_stage_a_run_is_stale_by_the_review_group_alone(monkeypatch):
    """Back to review is the one way a run reaches the stage, and it makes it out of date; no
    other group is read there, so the stage's reads stay off the approved applications."""
    monkeypatch.setattr(Lifecycle, "changed_since_run", lambda _market: pytest.fail("read"))
    back = ("draft", "applications", "assignment", "applications")
    assert Lifecycle.allocation(
        market(MarketPhase.APPLICATIONS, a_run(), phases=back)) is A.STALE
    assert Lifecycle.allocation(
        market(MarketPhase.APPLICATIONS, a_run(**PLAN_CHANGED, phases=back), phases=back)) is (
        A.CURRENT)


@pytest.mark.parametrize("phase", [MarketPhase.DRAFT, MarketPhase.OFFERS,
                                   MarketPhase.MARKET_DAYS, MarketPhase.ARCHIVED])
def test_outside_the_two_phases_a_run_is_never_judged_stale(monkeypatch, phase):
    """No run can happen there, and a running market's reads stay off the approved
    applications."""
    monkeypatch.setattr(Lifecycle, "changed_since_run", lambda _market: pytest.fail("read"))
    monkeypatch.setattr(Lifecycle, "review_reopened_since_run",
                        lambda _market: pytest.fail("read"))
    assert Lifecycle.allocation(market(phase, a_run(**PLAN_CHANGED))) is A.CURRENT


@pytest.mark.parametrize("published_revision, revision, standing", [
    (None, 4, A.PUBLISHED),
    (4, 4, A.PUBLISHED),
    (4, 5, A.CHANGED_SINCE_PUBLISHED),
], ids=["published before the revision was recorded", "as published", "changed since"])
def test_published_results_read_the_revision_publish_stood_on(
        published_revision, revision, standing):
    assignment = stored_assignment("run", [row(hand_placed=False)], made_from=made_from(),
                                   revision=revision, published_revision=published_revision)
    assert Lifecycle.allocation(
        market(MarketPhase.MARKET_DAYS, assignment, resultsPublished=True)) is standing


def test_results_are_out_when_published_or_changed_since():
    assert {standing for standing in A if Lifecycle.results_out(standing)} == {
        A.PUBLISHED, A.CHANGED_SINCE_PUBLISHED}


@pytest.mark.parametrize("phase, assignment, fields, standing", [
    (MarketPhase.ASSIGNMENT, stored_assignment("none"), {}, "none"),
    (MarketPhase.ASSIGNMENT, stored_assignment("pinned", [row()]), {}, "pinned"),
    (MarketPhase.ASSIGNMENT, a_run(), {}, "current"),
    (MarketPhase.ASSIGNMENT, a_run(**PLAN_CHANGED), {}, "stale"),
    (MarketPhase.MARKET_DAYS, a_run(), {"resultsPublished": True}, "published"),
], ids=["none", "pinned", "current", "stale", "published"])
def test_the_market_read_serves_the_allocation(monkeypatch, phase, assignment, fields, standing):
    monkeypatch.setattr(UsersApi, "get_user", lambda _email: SimpleNamespace(
        id="user-1", email="owner@example.com"))
    monkeypatch.setattr(UsersApi, "get_user_by_id", lambda _uid: None)
    monkeypatch.setattr(OrgsApi, "get_organization", lambda _oid: None)
    monkeypatch.setattr(PermissionsApi, "get_user_market_role",
                        lambda *_args, **_kwargs: MarketRole.OWNER)
    monkeypatch.setattr(MarketsApi, "markets_collection", FakeMarketsCollection(stored_market(
        phase, _id="mongo-1", setupObject=PLAN, phaseHistory=history(*REVIEWED_ONCE),
        assignmentObject=assignment, **fields)))

    assert MarketsApi.get_market_for_user("owner@example.com", "market-123")["allocation"] == (
        standing)


# --- The fixtures refuse what no write could store ----------------------------------------------


@pytest.mark.parametrize("state, rows, made_from_", [
    ("run", [row(hand_placed=False)], None),
    ("pinned", [], None),
    ("pinned", [row(hand_placed=False)], None),
    ("pinned", [row()], {"rules": "r"}),
    ("none", [row()], None),
    ("none", [], {"rules": "r"}),
])
def test_the_fixture_refuses_a_state_its_rows_contradict(state, rows, made_from_):
    with pytest.raises(ValueError):
        stored_assignment(state, rows, made_from=made_from_)
    with pytest.raises(ValueError):
        assignment_object(state, rows, made_from=made_from_)


def test_the_fixtures_twin_is_the_same_assignment():
    stored = stored_assignment("run", [row()], made_from={"rules": "r"}, revision=2,
                               published_revision=2)
    model = assignment_object("run", [row()], made_from={"rules": "r"}, revision=2,
                              published_revision=2)
    assert (model.state, model.made_from, model.revision, model.published_revision) == (
        RUN, {"rules": "r"}, 2, 2)
    assert Lifecycle.state_of(model, "market-123") is RUN
    assert stored["state"] == "run"


# --- Every route's write stores the state it leaves ---------------------------------------------


@pytest.fixture
def markets(monkeypatch):
    fake = FakeMarketsCollection(None)
    monkeypatch.setattr(MarketsApi, "markets_collection", fake)
    monkeypatch.setattr(MarketWrite, "markets_collection", fake)
    monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_k: True)
    monkeypatch.setattr(PlacementsApi, "has_applied", lambda _market_id, _address: True)
    return fake


SEATED = {
    "none": stored_assignment("none"),
    "pinned": stored_assignment("pinned", [row(), row("ben@example.com", "Hall A 2")]),
    "run": stored_assignment("run", [row(hand_placed=False),
                                     row("ben@example.com", "Hall A 2", hand_placed=False)],
                             made_from={"rules": "r", "plan": "p", "applications": "a",
                                        "review": "1"}),
}


def seat(markets, start, rows=None):
    assignment = dict(SEATED[start])
    if rows is not None:
        assignment["vendorAssignments"] = [r for r in assignment["vendorAssignments"]
                                           if r["email"] in rows]
    markets.doc = stored_market(MarketPhase.ASSIGNMENT, setupObject=PLAN,
                                phaseHistory=history(*REVIEWED_ONCE), assignmentObject=assignment)


def stored(markets) -> dict:
    """The stored assignment, which must agree with its own rows and ``madeFrom``."""
    assignment = markets.doc["assignmentObject"]
    model = market_from_document(markets.doc).assignment_object
    assert Lifecycle.derived_state(model).state.value == assignment["state"]
    return assignment


@pytest.mark.parametrize("start, after", [("none", "pinned"), ("pinned", "pinned"),
                                          ("run", "run")])
def test_an_assignment_by_hand_stores_its_state(markets, start, after):
    seat(markets, start)
    PlacementsApi.write_placement("market-123", {
        "email": "cara@example.com", "date": DAY, "table_code": "Hall A 3",
        "table_choice": "Full Table"}, "user-1")
    assert stored(markets)["state"] == after


@pytest.mark.parametrize("start", ["pinned", "run"])
def test_a_move_stores_its_state(markets, start):
    seat(markets, start)
    PlacementsApi.write_placement("market-123", {
        "email": "ana@example.com", "date": DAY, "table_code": "Hall A 3",
        "table_choice": "Full Table"}, "user-1")
    assert stored(markets)["state"] == start


@pytest.mark.parametrize("start", ["pinned", "run"])
def test_a_swap_stores_its_state(markets, start):
    seat(markets, start)
    PlacementsApi.swap_placements("market-123", DAY, "ana@example.com", "ben@example.com",
                                  "user-1")
    assert stored(markets)["state"] == start


@pytest.mark.parametrize("start, kept, after", [
    ("pinned", ["ben@example.com"], "pinned"),
    ("run", ["ben@example.com"], "run"),
    ("pinned", [], "none"),
    ("run", [], "run"),
], ids=["a pin of two", "a run of two", "the last pin", "a run's last row"])
def test_a_free_stores_its_state(markets, start, kept, after):
    seat(markets, start, rows=["ana@example.com", *kept])
    _result, status = PlacementsApi.remove_placement("market-123", "ana@example.com", DAY,
                                                     "user-1")
    assert status == 200
    assignment = stored(markets)
    assert [r["email"] for r in assignment["vendorAssignments"]] == kept
    assert assignment["state"] == after


def test_a_free_that_frees_nothing_writes_nothing(markets):
    seat(markets, "none")
    result, status = PlacementsApi.remove_placement("market-123", "ana@example.com", DAY,
                                                    "user-1")
    assert (status, result) == (200, {"removed": 0})
    assert markets.last_update is None
    assert markets.doc["assignmentObject"] == SEATED["none"]


@pytest.mark.parametrize("start", ["none", "pinned", "run"])
def test_a_run_stores_its_state_and_what_it_was_made_from(markets, monkeypatch, start):
    seat(markets, start)
    vendors = [a_solver_vendor("cara", section_ranking=("Hall A",))]
    monkeypatch.setattr(PlacementsApi, "solver_vendors_for", lambda _market: vendors)

    _result, status = PlacementsApi.run_assignment("market-123", "user-1")

    assert status == 200
    assignment = stored(markets)
    assert assignment["state"] == "run"
    assert assignment["madeFrom"] == made_from(
    ) | {"applications": MadeFrom.fingerprint(None, vendors, [])["applications"]}
    assert "cara@example.com" in {r["email"] for r in assignment["vendorAssignments"]}


def test_a_write_repairs_a_state_a_rolled_back_release_left(markets):
    """A pin written by a release that stores no state, over a market this one stored as none."""
    seat(markets, "none")
    markets.doc["assignmentObject"]["vendorAssignments"] = [row()]
    PlacementsApi.write_placement("market-123", {
        "email": "ben@example.com", "date": DAY, "table_code": "Hall A 2",
        "table_choice": "Full Table"}, "user-1")
    assert stored(markets)["state"] == "pinned"


# --- store --------------------------------------------------------------------------------------


@pytest.mark.parametrize("event, made_from_", [
    (RUN_EVENT, None), (PLACE, {"rules": "r"}), (FREE, {"rules": "r"}),
])
def test_only_a_run_records_what_it_was_made_from(markets, event, made_from_):
    seat(markets, "pinned")
    with pytest.raises(RuntimeError):
        Lifecycle.store(market_from_document(markets.doc), event, [], assignment_date="",
                        made_from=made_from_)
    assert markets.last_update is None


def test_store_holds_the_revision_it_read_and_counts_it(markets):
    seat(markets, "pinned")
    as_read = market_from_document(markets.doc)
    Lifecycle.store(as_read, PLACE, ONE_ROW, assignment_date="d")
    assert markets.doc["assignmentObject"]["revision"] == 1
    with pytest.raises(MarketWrite.MarketChanged):
        Lifecycle.store(as_read, PLACE, ONE_ROW, assignment_date="d")
    assert markets.doc["assignmentObject"]["revision"] == 1


def test_a_run_holds_results_published_as_read(markets):
    seat(markets, "run")
    as_read = market_from_document(copy.deepcopy(markets.doc))
    markets.doc["resultsPublished"] = True
    with pytest.raises(MarketWrite.MarketChanged):
        Lifecycle.store(as_read, RUN_EVENT, ONE_ROW, assignment_date="d",
                        made_from={"rules": "r"})
    assert markets.doc["assignmentObject"] == SEATED["run"]


def test_a_write_leaves_the_published_revision_as_publish_stored_it(markets):
    seat(markets, "run")
    markets.doc["assignmentObject"]["publishedRevision"] = 0
    markets.doc["resultsPublished"] = True
    Lifecycle.store(market_from_document(markets.doc), FREE, ONE_ROW, assignment_date="d")
    assert markets.doc["assignmentObject"]["publishedRevision"] == 0
    assert Lifecycle.allocation(market_from_document(markets.doc)) is A.CHANGED_SINCE_PUBLISHED
