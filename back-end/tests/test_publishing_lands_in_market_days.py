"""Publishing a market lands it in `market_days`. `archived` means finished, and only that.

E03/F03, decided by wayfinder ticket 06.

Publishing used to be `draft -> archived`, so `archived` meant two opposite things: this market has
just gone live, and this market is over. `CONTEXT.md` names phase as the single source of truth for
a market's lifecycle, and a value meaning both is not a source of truth.

`market_days` already existed and already meant "the market is running". It was unreachable in
practice: its only inbound edge was `offers -> market_days`, and `assignment -> offers` is
deadlocked - `NoApprovedApplicationsGuard` blocks it while any application is `reviewer_approved`,
and nothing in `back-end/` ever writes `assigned` or `unassigned` to clear that. So the phase was
stranded behind out-of-scope work rather than missing.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import api.applications as ApplicationsApi  # noqa: E402
import guards  # noqa: E402
from conftest import FakeSlugMarketsCollection, stored_market  # noqa: E402
from datatypes import (  # noqa: E402
    AssignmentObject, Market, MarketPhase, MarketRole, market_name_slug,
)
from guards import VALID_TRANSITIONS, evaluate_transition  # noqa: E402
from market_documents import applicant_intake_market_by_slug, published_market_by_slug  # noqa: E402

SLUG = market_name_slug("Test Market")


def _market(phase=MarketPhase.ASSIGNMENT, assignments=("vendor@example.com",)):
    return Market(
        id="market-1",
        name="Test Market",
        creation_date="2026-01-01",
        roles={"user-1": MarketRole.OWNER},
        modification_list=[],
        assignment_object=AssignmentObject(
            vendor_assignments=[
                {
                    "email": e, "date": "2026-05-01", "table_code": "A1",
                    "table_choice": "Full Table", "section": "Main Hall",
                    "tier": "Standard", "location": "Hall",
                }
                for e in assignments
            ],
        ),
        phase=phase,
    )


class TestTheEdge:
    def test_assignment_can_reach_market_days(self):
        assert ("assignment", "market_days") in VALID_TRANSITIONS

    def test_the_old_offers_route_is_untouched(self):
        """Not replaced - offers is out of scope, and its route stays for when it is built."""
        assert ("offers", "market_days") in VALID_TRANSITIONS

    def test_archiving_from_every_phase_still_works(self):
        for phase in MarketPhase:
            if phase == MarketPhase.ARCHIVED:
                continue
            assert (phase.value, "archived") in VALID_TRANSITIONS

    def test_draft_to_archived_survives_as_abandonment(self):
        """Every `* -> archived` edge now means "this market is over", including from draft."""
        assert ("draft", "archived") in VALID_TRANSITIONS


class TestTheEntryInvariant:
    """Guarding the phase, not the edge, so a second route later cannot bypass it."""

    def test_it_is_an_entry_invariant(self):
        assert "market_days" in guards.PHASE_ENTRY_INVARIANTS
        assert guards.PHASE_ENTRY_INVARIANTS["market_days"]

    def test_publishing_a_computed_assignment_is_allowed(self):
        assert evaluate_transition(_market(), MarketPhase.MARKET_DAYS, None) == []

    def test_publishing_without_an_assignment_is_refused(self):
        """The transition endpoint is reachable directly; a hidden button is not a rule."""
        blockers = evaluate_transition(_market(assignments=()), MarketPhase.MARKET_DAYS, None)

        assert blockers
        assert any(b.id == "assignment_computed" for b in blockers)

    def test_it_checks_something_the_solver_actually_writes(self):
        """`offers` is deadlocked precisely because its invariant checks something nothing sets.

        The solver writes `assignmentObject.vendorAssignments`, so that is what this reads.
        """
        blocked = evaluate_transition(_market(assignments=()), MarketPhase.MARKET_DAYS, None)
        allowed = evaluate_transition(_market(), MarketPhase.MARKET_DAYS, None)

        assert blocked and not allowed

    def test_every_inbound_edge_carries_it(self):
        for frm, to in VALID_TRANSITIONS:
            if to != "market_days":
                continue
            assert guards.TRANSITION_GUARDS.get((frm, to)), (
                f"{frm} -> market_days bypasses the entry invariant"
            )


class TestWhatEachPublicSurfaceServes:
    """The two lookups answer different questions, so each names its own phases."""

    def _collection(self, phase):
        doc = stored_market(phase=phase)
        doc["intakeMode"] = "form"
        return FakeSlugMarketsCollection(doc)

    def test_check_in_serves_a_running_market(self):
        assert published_market_by_slug(self._collection(MarketPhase.MARKET_DAYS), SLUG)

    def test_check_in_does_not_serve_an_abandoned_market(self):
        """A market archived from draft has no assignment; nobody can check in to it."""
        assert published_market_by_slug(self._collection(MarketPhase.ARCHIVED), SLUG) is None

    def test_check_in_does_not_serve_a_draft(self):
        assert published_market_by_slug(self._collection(MarketPhase.DRAFT), SLUG) is None

    def test_applicant_intake_serves_a_market_taking_applications(self):
        found = applicant_intake_market_by_slug(
            self._collection(MarketPhase.APPLICATIONS_OPEN), SLUG,
        )
        assert found

    @pytest.mark.parametrize("phase", [
        MarketPhase.APPLICATIONS_CLOSED,
        MarketPhase.REVIEW,
        MarketPhase.ASSIGNMENT,
        MarketPhase.MARKET_DAYS,
        MarketPhase.ARCHIVED,
    ])
    def test_applicant_intake_stops_once_applications_close(self, phase):
        """Stricter than before, and the safe direction: a stranger applying to a market that has
        already assigned was the old behaviour, and it was wrong."""
        assert applicant_intake_market_by_slug(self._collection(phase), SLUG) is None
