"""Every (allocation, event) pair, through the product (T316).

Each case reaches its starting allocation through the product's own events: a pin is a placement
by hand, a run is a real ``POST /markets/<id>/assignment`` over the solver, stale is a rule changed
after the run, published is a real Publish results, and changed since published is a placement by
hand after it. It then fires one event through its route and asserts the answer, taken or refused
with which sentence, and the ``allocation`` the market read serves after it. After every taken
write the stored ``state`` agrees with the stored rows and ``madeFrom``.

"Input changes" is a change to the assignment rules (``PUT /markets/<id>/plan``): a vendor added by
hand is seated by hand and never read by a run (``approved_solver_vendors``), so adding one changes
nothing a run was made from.
"""
import copy
from typing import NamedTuple, Optional

import pytest

from conftest import FakeApplicationsCollection, stored_assignment
from test_back_to_review import (  # noqa: F401 (world and runs are fixtures)
    DAY, MARKET, _application, _market, runs, world,
)

import api.attendance as AttendanceApi
import api.markets as MarketsApi
import api.placements as PlacementsApi
import assignment.lifecycle as Lifecycle
import guards
from assignment.utils import convert_keys_to_snake_case
from datatypes import AssignmentObject, AssignmentState
from market_documents import market_from_document

ANA = "ana@example.com"
BEN = "ben@example.com"
TABLES = [f"Main Hall {n}" for n in range(1, 5)]

ALREADY = "Results are already published."
OUT_OF_DATE = (
    "The table allocation is out of date. Allocate tables again before publishing, so applicants "
    "are told what the market will hold.")
NOTHING = "Allocate tables first: results tell each applicant whether they have a table."
PINS_ONLY = (
    "Only tables assigned by hand are stored. Allocate tables first: allocating keeps them and "
    "assigns every other approved vendor, so each applicant is told whether they have a table.")
RUN_REFUSED = PlacementsApi.RESULTS_PUBLISHED_REFUSAL
RULES_REFUSED = MarketsApi.ASSIGNMENT_RULES_PUBLISHED
#: Back to review's refusal, a blocker: its guard's id.
NOT_BACK = "results_not_published"


@pytest.fixture
def table(world, runs, monkeypatch):
    """A form market in Assignment with two approved vendors, Ana and Ben, and nothing allocated."""
    markets = world.install(_market(assignmentObject=stored_assignment("none")))
    world.applications.documents = [
        {**_application(), "id": "app-ana", "applicant_email": ANA},
        {**_application(), "id": "app-ben", "applicant_email": BEN, "form_data": {"shop": "Kiln"}},
    ]
    monkeypatch.setattr(AttendanceApi, "attendance_collection", FakeApplicationsCollection())
    return Table(world.client, markets, runs)


class Answer(NamedTuple):
    status: int
    refusal: Optional[str]


class Table:
    """The market and the routes an organizer fires at it."""

    def __init__(self, client, markets, run):
        self.client, self.markets, self._run = client, markets, run

    # --- reading ----------------------------------------------------------------------------------

    def served(self):
        return self.client.get(f"/markets/{MARKET}").get_json()["market"]

    def allocation(self):
        return self.served()["allocation"]

    def rows(self):
        return self.markets.doc["assignmentObject"]["vendorAssignments"]

    def seat_of(self, email):
        return next(row["tableCode"] for row in self.rows() if row["email"] == email)

    def free_table(self):
        taken = {row["tableCode"] for row in self.rows() if row["date"] == DAY}
        return next(table for table in TABLES if table not in taken)

    # --- the events -------------------------------------------------------------------------------

    @staticmethod
    def _answer(response):
        body = response.get_json() or {}
        if response.status_code < 300:
            return Answer(response.status_code, None)
        blockers = body.get("blockers")
        return Answer(response.status_code,
                      blockers[0]["id"] if blockers else body.get("error"))

    def place(self, email=ANA):
        return self._answer(self.client.put(f"/markets/{MARKET}/placements", json={
            "email": email, "date": DAY, "tableCode": self.free_table(),
            "tableChoice": "Full Table"}))

    def swap(self):
        return self._answer(self.client.post(
            f"/markets/{MARKET}/placements/swap", json={"date": DAY, "emails": [ANA, BEN]}))

    def free(self, email=ANA):
        return self._answer(self.client.delete(
            f"/markets/{MARKET}/placements", json={"email": email, "date": DAY}))

    def run(self):
        return self._answer(self.client.post(f"/markets/{MARKET}/assignment"))

    def change_inputs(self):
        """Change an assignment rule, which a run reads, through the plan's own save."""
        served = self.served()
        plan = copy.deepcopy(self.markets.doc["setupObject"])
        plan["assignmentOptions"] = {
            **(plan.get("assignmentOptions") or {}),
            "maxAssignmentsPerVendor": 1 + int(
                (plan.get("assignmentOptions") or {}).get("maxAssignmentsPerVendor") or 0)}
        return self._answer(self.client.put(f"/markets/{MARKET}/plan", json={
            "setupObject": plan, "planRevision": served["planRevision"]}))

    def publish(self):
        return self._answer(self.client.post(f"/markets/{MARKET}/publish-results"))

    def back_to_review(self):
        return self._answer(self.client.post(
            f"/markets/{MARKET}/transition", json={"toPhase": "applications"}))

    # --- the starting allocations, reached by the product's events --------------------------------

    def reach(self, allocation):
        taken = Answer(200, None)
        if allocation == "pinned":
            assert self.place(ANA) == taken
            assert self.place(BEN) == taken
        if allocation in ("current", "stale", "published", "changed_since_published"):
            self._run()
        if allocation == "stale":
            assert self.change_inputs() == taken
        if allocation in ("published", "changed_since_published"):
            assert self.publish() == taken
        if allocation == "changed_since_published":
            assert self.place(ANA) == taken
        assert self.allocation() == allocation


def assert_the_state_agrees(markets):
    """The stored state is the one the stored rows and ``madeFrom`` give."""
    stored = markets.doc["assignmentObject"]
    model = AssignmentObject(**convert_keys_to_snake_case(
        {key: value for key, value in stored.items() if key != "madeFrom"}))
    model = model.model_copy(update={"made_from": stored.get("madeFrom")})
    assert stored.get("state") is not None, stored
    assert Lifecycle.derived_state(model).state is AssignmentState(stored["state"]), stored


TAKEN = Answer(200, None)

#: (from, event) -> (the answer, the allocation after), the spec's table.
CASES = {
    ("none", "place"): (TAKEN, "pinned"),
    ("none", "free"): (TAKEN, "none"),
    ("none", "run"): (TAKEN, "current"),
    ("none", "input changes"): (TAKEN, "none"),
    ("none", "publish"): (Answer(409, NOTHING), "none"),
    ("none", "back to review"): (TAKEN, "none"),

    ("pinned", "place"): (TAKEN, "pinned"),
    ("pinned", "swap"): (TAKEN, "pinned"),
    ("pinned", "free"): (TAKEN, "pinned"),
    ("pinned", "run"): (TAKEN, "current"),
    ("pinned", "input changes"): (TAKEN, "pinned"),
    ("pinned", "publish"): (Answer(409, PINS_ONLY), "pinned"),
    ("pinned", "back to review"): (TAKEN, "pinned"),

    ("current", "place"): (TAKEN, "current"),
    ("current", "swap"): (TAKEN, "current"),
    ("current", "free"): (TAKEN, "current"),
    ("current", "run"): (TAKEN, "current"),
    ("current", "input changes"): (TAKEN, "stale"),
    ("current", "publish"): (TAKEN, "published"),
    ("current", "back to review"): (TAKEN, "stale"),

    ("stale", "place"): (TAKEN, "stale"),
    ("stale", "swap"): (TAKEN, "stale"),
    ("stale", "free"): (TAKEN, "stale"),
    ("stale", "run"): (TAKEN, "current"),
    ("stale", "input changes"): (TAKEN, "stale"),
    ("stale", "publish"): (Answer(409, OUT_OF_DATE), "stale"),
    ("stale", "back to review"): (TAKEN, "stale"),

    ("published", "place"): (TAKEN, "changed_since_published"),
    ("published", "swap"): (TAKEN, "changed_since_published"),
    ("published", "free"): (TAKEN, "changed_since_published"),
    ("published", "run"): (Answer(409, RUN_REFUSED), "published"),
    ("published", "input changes"): (Answer(400, RULES_REFUSED), "published"),
    ("published", "publish"): (Answer(409, ALREADY), "published"),
    ("published", "back to review"): (Answer(409, NOT_BACK), "published"),

    ("changed_since_published", "place"): (TAKEN, "changed_since_published"),
    ("changed_since_published", "swap"): (TAKEN, "changed_since_published"),
    ("changed_since_published", "free"): (TAKEN, "changed_since_published"),
    ("changed_since_published", "run"): (Answer(409, RUN_REFUSED), "changed_since_published"),
    ("changed_since_published", "input changes"): (
        Answer(400, RULES_REFUSED), "changed_since_published"),
    ("changed_since_published", "publish"): (Answer(409, ALREADY), "changed_since_published"),
    ("changed_since_published", "back to review"): (
        Answer(409, NOT_BACK), "changed_since_published"),
}

ALLOCATIONS = [a.value for a in Lifecycle.Allocation]
#: The spec's six columns; "place or swap" is both, and a swap needs two vendors seated, which
#: nothing is in ``none``.
EVENTS = ["place", "swap", "free", "run", "input changes", "publish", "back to review"]


def test_the_cases_are_every_pair_of_the_spec():
    assert set(CASES) == {(a, e) for a in ALLOCATIONS for e in EVENTS} - {("none", "swap")}
    assert len({(a, "place or swap" if e in ("place", "swap") else e) for a, e in CASES}) == 36


def _fire(table, event):
    return {
        "place": table.place,
        "swap": table.swap,
        "free": table.free,
        "run": table.run,
        "input changes": table.change_inputs,
        "publish": table.publish,
        "back to review": table.back_to_review,
    }[event]()


@pytest.mark.parametrize("start,event", sorted(CASES), ids=lambda value: value.replace(" ", "-"))
def test_each_event_from_each_allocation(table, start, event):
    answer, after = CASES[(start, event)]
    table.reach(start)
    before = copy.deepcopy(table.markets.doc)

    assert _fire(table, event) == answer

    assert table.allocation() == after
    if answer.status == 200:
        assert_the_state_agrees(table.markets)
    if answer.status != 200 or (start, event) == ("none", "free"):
        # Refused, or a free that freed nothing: nothing about the assignment was written.
        assert table.markets.doc["assignmentObject"] == before["assignmentObject"]
        assert table.markets.doc.get("resultsPublished") == before.get("resultsPublished")


def test_a_free_of_nothing_answers_that_it_removed_nothing(table):
    response = table.client.delete(f"/markets/{MARKET}/placements", json={"email": ANA, "date": DAY})

    assert (response.status_code, response.get_json()) == (200, {"removed": 0})


def test_pins_only_reads_none_when_the_last_pin_goes(table):
    assert table.place(ANA) == TAKEN
    assert table.allocation() == "pinned"

    assert table.free(ANA) == TAKEN

    assert table.allocation() == "none"
    assert_the_state_agrees(table.markets)


def test_a_run_freed_down_to_nobody_is_still_a_run(table):
    table.reach("current")

    for email in (ANA, BEN):
        assert table.free(email) == TAKEN

    assert table.rows() == []
    assert table.allocation() == "current"
    assert table.markets.doc["assignmentObject"]["state"] == "run"


def test_a_run_keeps_the_tables_assigned_by_hand(table):
    table.reach("pinned")
    pinned = {email: table.seat_of(email) for email in (ANA, BEN)}

    assert table.run() == TAKEN

    assert {email: table.seat_of(email) for email in (ANA, BEN)} == pinned
    assert all(row["handPlaced"] for row in table.rows())


# --- Going live: the three assignment invariants and the owner's conjunction --------------------

#: The ``market_days`` entry invariants about the allocation; ``no_orphaned_pin`` is the plan's.
ASSIGNMENT_INVARIANTS = {"assignment_computed", "assignment_after_review", "results_published"}


def _invariants_pass(markets):
    market = market_from_document(markets.doc)
    verdicts = {guard.id: guard.evaluate(market, None).passed
                for guard in guards.PHASE_ENTRY_INVARIANTS["market_days"]
                if guard.id in ASSIGNMENT_INVARIANTS}
    assert set(verdicts) == ASSIGNMENT_INVARIANTS
    return all(verdicts.values())


@pytest.mark.parametrize("start", ALLOCATIONS)
@pytest.mark.parametrize("emptied", [False, True], ids=["with rows", "every seat freed"])
def test_the_invariants_pass_together_exactly_when_the_market_may_go_live(table, start, emptied):
    table.reach(start)
    if emptied:
        for email in {row["email"] for row in table.rows()}:
            assert table.free(email) == TAKEN

    may = Lifecycle.may_go_live(market_from_document(table.markets.doc))

    assert _invariants_pass(table.markets) is may
    assert may is (start in ("published", "changed_since_published") and not emptied)


def test_going_live_is_taken_exactly_when_the_owner_says_so(table):
    table.reach("published")
    assert Lifecycle.may_go_live(market_from_document(table.markets.doc))

    response = table.client.post(f"/markets/{MARKET}/transition", json={"toPhase": "market_days"})

    assert response.status_code == 200, response.get_json()
    assert table.markets.doc["phase"] == "market_days"


@pytest.mark.parametrize("start", ALLOCATIONS)
def test_publish_is_offered_exactly_when_the_owner_may_publish(table, start):
    table.reach(start)

    may = Lifecycle.may_publish(market_from_document(table.markets.doc))

    assert may is (table.served()["publishWaitsReason"] is None)
    assert may is (start == "current")


def test_a_vendor_added_by_hand_leaves_a_run_current(table):
    """A vendor added by hand is seated by hand, never by a run, so nothing a run was made from
    changes: this is why the table's input change is a rule."""
    table.reach("current")

    response = table.client.post(f"/markets/{MARKET}/vendors", json={
        "name": "Fixture Stall", "email": "added@example.com", "answers": {}})

    assert response.status_code == 201, response.get_json()
    assert table.allocation() == "current"
