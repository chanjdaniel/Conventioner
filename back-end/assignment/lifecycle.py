"""The assignment's lifecycle: the one owner of where a market's assignment stands (T316).

Where the assignment stood used to be read off five fields (the rows, their hand-placed flags,
``madeFrom``, ``resultsPublished`` and the phase), each reader with its own precedence, so a market
holding only tables assigned by hand could not be told apart from one whose tables were allocated.
So the assignment stores its state, ``assignmentObject.state``, and this module is the only writer
of it, of the rows beside it, and of ``publishedRevision``:

- The state is ``none`` (no row, no run), ``pinned`` (only tables assigned by hand, no run yet) or
  ``run`` (a table allocation was run). A run always records what it was made from: ``madeFrom``
  is required on ``run``, and an allocation stored before runs recorded it carries
  ``LEGACY_MADE_FROM``, which holds no group, so it is never read as out of date.
- ``state_of`` reads it, trusting the stored state only while it agrees with the stored rows and
  ``madeFrom``; otherwise it reads the state ``derived_state`` gives, which the migration
  (``migrations/migrate_assignment_state.py``) also writes. A release rolled back to does not write
  the state, so the read must survive a stored state its writes left behind.
- ``next_state`` is every transition: an assignment by hand, a move and a swap are ``place``, a
  free is ``free``, and a table allocation is ``run``. Changing the rules, the plan or the approved
  applications, and Back to review, write nothing here: they change only what ``allocation`` reads.
- ``store`` is the one write of the rows and the state, holding what the request read.
- ``allocation`` is where the table allocation stands, served on the market read as
  ``allocation``: ``none``, ``pinned``, ``current``, ``stale``, ``published`` or
  ``changed_since_published``. ``results_out`` asks it whether results are published, and
  ``results_published`` asks it of a market, as every refusal that reads the assignment does.
- ``publish_refusal`` is why Publish results waits: for a run that is current, never on tables
  assigned by hand alone. ``publish`` is its write, storing the revision it stood on, and
  ``may_go_live`` is what the ``market_days`` entry invariants about the assignment ask together.

Imports nothing in ``api/``, so the guards, the routes and the migration can all import it.
"""
import logging
from enum import Enum
from typing import Any, Dict, List, Mapping, NamedTuple, Optional, Sequence

from assignment.made_from import changed_since_run, review_reopened_since_run
from assignment.utils import convert_keys_to_camel_case
from datatypes import (
    AssignmentObject, AssignmentState, Market, MarketPhase, VendorAssignmentResult,
)
from market_documents import market_doc_key
from market_write import document_as_read, write_market

logger = logging.getLogger(__name__)

#: What an allocation stored before runs recorded what they were made from is made from. It holds
#: no group of ``made_from.GROUPS``, so ``changed_since_run`` and ``review_reopened_since_run`` read
#: it as not known to be out of date, as they read no ``madeFrom``.
LEGACY_MADE_FROM: Dict[str, str] = {"legacy": "before-fingerprints"}


class Allocation(str, Enum):
    """Where a market's table allocation stands, served on the market read as ``allocation``."""

    #: Nothing is stored, and no table allocation has been run.
    NONE = "none"
    #: Only tables assigned by hand are stored: no table allocation has been run yet.
    PINNED = "pinned"
    #: A table allocation was run, and nothing it was made from has changed since.
    CURRENT = "current"
    #: A table allocation was run, and something it was made from has changed since.
    STALE = "stale"
    #: Results are published, and the assignment is the one they were published on.
    PUBLISHED = "published"
    #: Results are published, and the assignment has been changed by hand since.
    CHANGED_SINCE_PUBLISHED = "changed_since_published"


class Event(str, Enum):
    """A write to the assignment."""

    #: An assignment by hand, a move or a swap.
    PLACE = "place"
    #: A seat freed.
    FREE = "free"
    #: A table allocation run.
    RUN = "run"


class Derived(NamedTuple):
    """The state an assignment's rows and ``madeFrom`` give, and the ``madeFrom`` it should hold."""

    state: AssignmentState
    made_from: Optional[Dict[str, str]]


def derived_state(assignment_object: AssignmentObject) -> Derived:
    """The state the stored rows and ``madeFrom`` give, read and migrated by one rule.

    ``run`` where ``madeFrom`` exists; ``pinned`` where there are rows, every one hand-placed, and
    no ``madeFrom``; ``run`` with ``LEGACY_MADE_FROM`` where there are rows and some row is not
    hand-placed, which only a run before fingerprints could have stored; else ``none``.
    """
    rows = assignment_object.vendor_assignments
    made_from = assignment_object.made_from
    if made_from:
        return Derived(AssignmentState.RUN, made_from)
    if not rows:
        return Derived(AssignmentState.NONE, None)
    if all(row.hand_placed for row in rows):
        return Derived(AssignmentState.PINNED, None)
    return Derived(AssignmentState.RUN, LEGACY_MADE_FROM)


def _agrees(state: AssignmentState, assignment_object: AssignmentObject) -> bool:
    """Whether a stored state agrees with the stored rows and ``madeFrom``."""
    has_rows = bool(assignment_object.vendor_assignments)
    has_made_from = bool(assignment_object.made_from)
    if state is AssignmentState.RUN:
        return has_made_from
    if state is AssignmentState.PINNED:
        return has_rows and not has_made_from
    return not has_rows and not has_made_from


def stored_state_agrees(assignment_object: AssignmentObject) -> bool:
    """Whether the assignment stores a state that agrees with its stored rows and ``madeFrom``:
    the state ``state_of`` trusts, and the one the migration leaves as it is."""
    stored = assignment_object.state
    return stored is not None and _agrees(stored, assignment_object)


def state_of(assignment_object: AssignmentObject, market_id: str) -> AssignmentState:
    """The state the assignment is in: the stored one when it agrees with the stored rows and
    ``madeFrom``, else the one ``derived_state`` gives.

    An absent state (a market neither written nor migrated since T316, a raw seed) is derived
    without a word. A stored state that disagrees, which a rolled-back release's write leaves,
    logs one warning naming the market by id and both states, never an address, and is read as
    derived: the migration repairs it. Never raises, since a market read must not fail on it.
    """
    stored = assignment_object.state
    if stored_state_agrees(assignment_object):
        return stored
    derived = derived_state(assignment_object).state
    if stored is not None:
        logger.warning(
            "Market %s stores assignment state %s, but its rows read as %s; read as %s",
            market_id, stored.value, derived.value, derived.value)
    return derived


def next_state(
    state: AssignmentState, event: Event, rows_after: Sequence[VendorAssignmentResult],
) -> AssignmentState:
    """The state after ``event``, from ``state``, leaving ``rows_after`` stored.

    A run makes every state ``run``. A place makes ``none`` and ``pinned`` ``pinned`` and leaves
    ``run``. A free leaves ``none``, makes ``pinned`` ``none`` once no row is left, and leaves
    ``run``: a run freed down to no row is still a run, since the allocation was made.
    """
    if event is Event.RUN or state is AssignmentState.RUN:
        return AssignmentState.RUN
    if event is Event.PLACE:
        return AssignmentState.PINNED
    if state is AssignmentState.PINNED and rows_after:
        return AssignmentState.PINNED
    return AssignmentState.NONE


def store(
    market: Market,
    event: Event,
    rows: List[VendorAssignmentResult],
    *,
    assignment_date: str,
    made_from: Optional[Dict[str, str]] = None,
) -> None:
    """Write the rows and the state ``event`` leaves onto the market as this request read it: the
    one write of the assignment's rows.

    Statistics are never persisted - every read derives them fresh - so only the fields that are
    the assignment itself are set. A ``$set`` of those keys rather than of the whole
    ``assignmentObject`` keeps a stale ``assignmentStatistics`` from being resurrected by a write,
    and leaves ``publishedRevision`` as Publish results stored it.

    The rows are the whole assignment as this request read it and changed it, so the write
    (``write_market``) lands only while the market is still in the phase it was read in and the
    stored ``revision`` is still the one read, and counts one more. Otherwise another change landed
    in between, and this one is refused with ``MarketChanged`` rather than stored over it: two
    organizers moving two vendors into one empty seat at once both got a 200, and one move was
    lost; a placement judged on a market's days landed on the market archived a moment before.
    The revision is read from the stored document, which a run's solver does not touch.

    ``made_from`` is what a run read (E22/F03/S01), and only a run passes it: a hand placement is
    an edit to the result, not an input, so it leaves the fingerprint alone. A run also holds
    ``resultsPublished`` as read, so an allocation never lands after Publish results told
    applicants the one before it.

    Raises:
        RuntimeError: a run with no ``made_from``, or anything else with one; only code calls this.
        MarketChanged: the market changed since it was read; nothing was stored.
    """
    if (event is Event.RUN) != (made_from is not None):
        raise RuntimeError(
            "lifecycle.store: a run records what it was made from, and nothing else does"
            f" (event {event.value}, made_from {'given' if made_from is not None else 'None'})")
    state = next_state(state_of(market.assignment_object, market.id), event, rows)
    written: Dict[str, Any] = {
        "assignmentObject.vendorAssignments": [
            convert_keys_to_camel_case(placement.model_dump()) for placement in rows
        ],
        "assignmentObject.assignmentDate": assignment_date,
        "assignmentObject.assignmentStatistics": None,
        "assignmentObject.state": state.value,
    }
    holds = []
    if made_from is not None:
        written["assignmentObject.madeFrom"] = made_from
        holds.append(market_doc_key("results_published"))
    assignment_key = market_doc_key("assignment_object")
    # An assignment written before the count existed has none, and one a market was created with
    # holds 0: ``write_market`` matches either for 0 or None.
    read_revision = (document_as_read(market).get(assignment_key) or {}).get("revision")
    write_market(market, {"$set": written}, holds=holds,
                 revisions={f"{assignment_key}.revision": read_revision})


def _stale(market: Market, changed: Optional[Sequence[str]]) -> bool:
    """Whether the stored run is out of date, judged as far as the market's phase can act on it.

    In ``assignment`` by every group (``changed_since_run``, or ``changed`` when the caller has
    already computed it); in ``applications`` by the review group alone, since Back to review is
    the one way a run reaches that phase and the cheap read keeps the stage's reads off the
    approved applications; in every other phase never, since no run can happen there, which keeps
    a running market's reads off the approved applications too.
    """
    if market.phase is MarketPhase.ASSIGNMENT:
        return bool(changed if changed is not None else changed_since_run(market))
    if market.phase is MarketPhase.APPLICATIONS:
        return review_reopened_since_run(market)
    return False


def allocation(
    market: Market, *, changed: Optional[Sequence[str]] = None, judge_stale: bool = True,
) -> Allocation:
    """Where the market's table allocation stands.

    With results published, ``published`` while the stored ``revision`` is the one Publish results
    stood on, or when none was recorded (a market published before T316 that the migration has not
    reached is not known to have changed); else ``changed_since_published``. Otherwise by
    ``state_of``: ``none`` and ``pinned`` as stored, and a run ``stale`` or ``current`` as
    ``_stale`` judges it. ``changed`` is ``changed_since_run(market)`` when the caller has it, so a
    read in ``assignment`` reads the approved applications once.

    ``judge_stale`` false reads a run as ``current`` without asking whether it is out of date: for
    a reader that asks only whether results are out or whether a run is stored, which staleness
    never changes. It reads neither the phase nor the approved applications, so the guards, whose
    verdicts must not depend on the phase they are asked in, read it so.
    """
    assignment_object = market.assignment_object
    if market.results_published:
        published_revision = assignment_object.published_revision
        if published_revision is None or published_revision == assignment_object.revision:
            return Allocation.PUBLISHED
        return Allocation.CHANGED_SINCE_PUBLISHED
    state = state_of(assignment_object, market.id)
    if state is AssignmentState.NONE:
        return Allocation.NONE
    if state is AssignmentState.PINNED:
        return Allocation.PINNED
    if judge_stale and _stale(market, changed):
        return Allocation.STALE
    return Allocation.CURRENT


def results_out(standing: Allocation) -> bool:
    """Whether results are published, as the assignment's own refusals ask it."""
    return standing in (Allocation.PUBLISHED, Allocation.CHANGED_SINCE_PUBLISHED)


def results_published(market: Market) -> bool:
    """Whether results are published, as the assignment's own refusals ask it: ``results_out`` of
    the allocation, which never needs its staleness judged.

    The applicant-facing reads ask the stored flag instead (``market_documents.results_are_out``):
    they ask whether applicants were told, not where the allocation stands.
    """
    return results_out(allocation(market, judge_stale=False))


ALREADY_PUBLISHED = "Results are already published."
PUBLISHED_IN_ASSIGNMENT = (
    "Results are published once tables have been allocated, so each applicant is told whether "
    "they have a table."
)
NOTHING_ALLOCATED = "Allocate tables first: results tell each applicant whether they have a table."
PINS_ONLY = (
    "Only tables assigned by hand are stored. Allocate tables first: allocating keeps them and "
    "assigns every other approved vendor, so each applicant is told whether they have a table."
)
OUT_OF_DATE = (
    "The table allocation is out of date. Allocate tables again before publishing, so applicants "
    "are told what the market will hold."
)
NOBODY_HAS_A_TABLE = (
    "Nobody has a table in this allocation, so every applicant would read that they did not get "
    "one. Allocate tables again, or assign tables, before publishing."
)


def publish_refusal(market: Market) -> Optional[str]:
    """Why results cannot be published now, or None while they can (E36/F04/S01, T316).

    Results wait for a table allocation that was run and is current, in ``assignment``, so every
    applicant is told what the market will hold. Tables assigned by hand alone are no allocation:
    publishing them told every other approved vendor they had no table, though the solver never
    ran (T277). A run freed down to no row is refused too, since it would tell every applicant no.
    """
    standing = allocation(market)
    if results_out(standing):
        return ALREADY_PUBLISHED
    if market.phase is not MarketPhase.ASSIGNMENT:
        return PUBLISHED_IN_ASSIGNMENT
    if standing is Allocation.NONE:
        return NOTHING_ALLOCATED
    if standing is Allocation.PINNED:
        return PINS_ONLY
    if standing is Allocation.STALE:
        return OUT_OF_DATE
    if not market.assignment_object.vendor_assignments:
        return NOBODY_HAS_A_TABLE
    return None


def may_publish(market: Market) -> bool:
    """Whether Publish results would be taken now: ``publish_refusal`` has nothing to say."""
    return publish_refusal(market) is None


def may_go_live(market: Market) -> bool:
    """Whether the assignment lets the market reach its market days: results are out, on at least
    one stored row. The ``market_days`` entry invariants keep one guard per condition, so the rail
    names the one that stands; together they pass exactly when this holds."""
    return results_published(market) and bool(market.assignment_object.vendor_assignments)


NOTHING_ALLOCATED_TO_GO_LIVE = (
    "No tables have been allocated for this market, so its vendor page could not tell anyone "
    "where to stand. Allocate tables first."
)
PINS_ONLY_TO_GO_LIVE = (
    "Only tables assigned by hand are stored, so every other approved vendor would read that they "
    "did not get one. Allocate tables first: allocating keeps the tables you assigned."
)
NOBODY_SEATED_AFTER_RESULTS = (
    "Nobody has a table, so this market's vendor page could not tell anyone where to stand. "
    "Results are published, so tables are not allocated again: assign each one by hand."
)
NOBODY_SEATED_SETTLED = (
    "Nobody has a table, so this market's vendor page could not tell anyone where to stand. "
    "The table allocation for this market is settled, so tables are not allocated again: assign "
    "each one by hand."
)


class Remedy(str, Enum):
    """What puts an unallocated market right: a run, or a seat given by hand where a run is refused."""

    RUN = "run"
    BY_HAND = "by_hand"


class Refusal(NamedTuple):
    """Why the market's allocation cannot go live, and what puts it right."""

    message: str
    remedy: Remedy


def unallocated_refusal(market: Market) -> Optional[Refusal]:
    """Why the market cannot go live on its allocation, or None once a run with a row is stored.

    The ``assignment_computed`` guard passes this on, so the phase is read here, never in a guard:
    its verdict is the same in every phase, and only its words and remedy follow where a run is
    still taken. A run is refused once results are out and outside ``assignment`` (a market left in
    Offers), so with nobody seated there the remedy is a seat given by hand (T316).
    """
    standing = allocation(market, judge_stale=False)
    seated = bool(market.assignment_object.vendor_assignments)
    if standing is Allocation.PINNED:
        return Refusal(PINS_ONLY_TO_GO_LIVE, Remedy.RUN)
    if seated and standing is not Allocation.NONE:
        return None
    if results_out(standing):
        return Refusal(NOBODY_SEATED_AFTER_RESULTS, Remedy.BY_HAND)
    if market.phase is not MarketPhase.ASSIGNMENT:
        return Refusal(NOBODY_SEATED_SETTLED, Remedy.BY_HAND)
    return Refusal(NOTHING_ALLOCATED_TO_GO_LIVE, Remedy.RUN)


def publish(document: Mapping[str, Any]) -> None:
    """Publish results' write: ``resultsPublished`` set, and ``publishedRevision`` set to the
    assignment ``revision`` it stood on, so a change by hand after it reads as
    ``changed_since_published``.

    ``document`` is the market as the caller read and judged it (``publish_refusal``). The write
    holds what that read (T207): the phase, since Back to review checks the flag and then moves
    it, and the flag against a second publish, so two requests in flight together never leave the
    review open on published results; and the assignment's revision, so an allocation stored after
    this one was judged refuses the publish rather than be published unjudged. A market whose
    assignment never stored a revision stood on 0, as the model reads it.

    Raises:
        MarketChanged: the market changed since it was read; nothing was stored.
    """
    assignment_key = market_doc_key("assignment_object")
    revision = (document.get(assignment_key) or {}).get("revision") or 0
    results_key = market_doc_key("results_published")
    write_market(document, {"$set": {
        results_key: True,
        f"{assignment_key}.publishedRevision": revision,
    }}, holds=(results_key, f"{assignment_key}.revision"))
