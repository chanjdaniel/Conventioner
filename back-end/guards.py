"""Centralized guard registry for market phase transitions (D16).

Every precondition for every phase transition lives in this single file.
Each guard bundles its ``id``, ``description``, and ``evaluate()`` method.
Adding or removing a precondition edits ONLY this file -- the endpoint and
frontend never change.

Design: guards are plain Python classes, not a rules engine (D16 refined).
No ABC, no DSL, no runtime mutation. Read this file to understand every
precondition in the system.

Phase 1 guards implemented:
  - ``FormHasFieldsGuard``  on every edge into ``applications_open``
    (``draft -> applications_open`` and ``applications_closed -> applications_open``)

Phase 2 guards implemented (conv-market-state-machine-t7):
  - ``AllApplicationsReviewedGuard`` on ``review -> assignment``
  - ``NoApprovedApplicationsGuard`` on ``assignment -> offers``
"""

from dataclasses import dataclass, field
from typing import Optional

import api.applications as ApplicationsApi
from datatypes import ApplicationStatus, Market, MarketPhase


# ── Wire shape (backend/frontend contract) ──────────────────────────────


@dataclass
class PreconditionResult:
    """Evaluated outcome of a guard check. The frontend renders this generically.

    This is the load-bearing design decision (D16). The ``BlockerPanel``
    component receives a list of these objects and renders each one with
    zero guard-specific logic.
    """
    id: str
    passed: bool
    message: str
    resolution_link: Optional[str] = None


# ── Guard classes ───────────────────────────────────────────────────────


class FormHasFieldsGuard:
    """Application form must have at least one field before publishing."""

    id: str = "form_has_fields"
    description: str = "Application form has at least one field"

    def evaluate(self, market: Market, db) -> PreconditionResult:
        form = market.application_form
        if form is None or len(form.fields) == 0:
            return PreconditionResult(
                id=self.id,
                passed=False,
                message=(
                    "The application form has no fields. "
                    "Add at least one field before publishing the market."
                ),
                resolution_link="/market-setup",
            )
        return PreconditionResult(id=self.id, passed=True, message="")


class AllApplicationsReviewedGuard:
    """Every application must be approved or rejected before assignment can begin.

    No application may still be ``open`` or ``under_review`` -- the review phase must
    have reached a verdict on every single one.
    """

    id: str = "all_applications_reviewed"
    description: str = "Every application is approved or rejected"

    def evaluate(self, market: Market, _db) -> PreconditionResult:
        total = ApplicationsApi.count_applications_for_market(market.id)
        unreviewed_count = ApplicationsApi.count_applications_with_any_status(
            market.id,
            [ApplicationStatus.OPEN.value, ApplicationStatus.UNDER_REVIEW.value],
        )
        if unreviewed_count > 0:
            app_word = (
                "application is" if unreviewed_count == 1 else "applications are"
            )
            return PreconditionResult(
                id=self.id,
                passed=False,
                message=(
                    f"{unreviewed_count} {app_word} still awaiting review. "
                    "Every application must be approved or rejected before assignment "
                    "can begin."
                ),
                resolution_link="/market-setup",
            )
        if total == 0:
            return PreconditionResult(
                id=self.id,
                passed=False,
                message=(
                    "There are no applications for this market. "
                    "At least one application must exist before assignment can begin."
                ),
                resolution_link=None,
            )
        return PreconditionResult(id=self.id, passed=True, message="")


class NoApprovedApplicationsGuard:
    """No application may remain ``reviewer_approved`` before entering the offers phase.

    The solver must have resolved every approved application to either ``assigned``
    or ``unassigned``. Any ``reviewer_approved`` application at this point means the
    solver has not run or did not complete.
    """

    id: str = "no_approved_applications"
    description: str = "No application remains reviewer_approved"

    def evaluate(self, market: Market, _db) -> PreconditionResult:
        approved_count = ApplicationsApi.count_applications_with_status(
            market.id, ApplicationStatus.REVIEWER_APPROVED.value,
        )
        if approved_count > 0:
            app_word = (
                "application is" if approved_count == 1 else "applications are"
            )
            return PreconditionResult(
                id=self.id,
                passed=False,
                message=(
                    f"{approved_count} {app_word} still approved but not yet "
                    "assigned or unassigned. Run the assignment solver before "
                    "sending offers."
                ),
                resolution_link="/assignment-results",
            )
        return PreconditionResult(id=self.id, passed=True, message="")


# ── Transition registry ─────────────────────────────────────────────────


# Transitions not in this set return 400 ("transition not available in current phase").
# Adding a new phase transition: add to this set + add to TRANSITION_GUARDS
# if the transition has preconditions.
VALID_TRANSITIONS: set[tuple[str, str]] = {
    # Pre-assignment back edges
    ("draft", "applications_open"),
    ("applications_open", "applications_closed"),
    ("applications_closed", "applications_open"),
    ("applications_closed", "review"),
    ("review", "applications_closed"),
    # Assignment and forward
    ("review", "assignment"),
    ("assignment", "offers"),
    ("offers", "market_days"),
    # Archive from anywhere
    ("draft", "archived"),
    ("applications_open", "archived"),
    ("applications_closed", "archived"),
    ("review", "archived"),
    ("assignment", "archived"),
    ("offers", "archived"),
    ("market_days", "archived"),
}

# Guards are stateless, so one instance is shared by every edge that enforces it.
_FORM_HAS_FIELDS = FormHasFieldsGuard()
_ALL_REVIEWED = AllApplicationsReviewedGuard()
_NO_APPROVED = NoApprovedApplicationsGuard()

# Entry invariants: what must hold of a market SITTING IN a phase, regardless of the
# route it took to get there. Every inbound edge to the phase must enforce these, so
# listing one here makes it impossible to reach the phase without it.
PHASE_ENTRY_INVARIANTS: dict[str, list] = {
    "applications_open": [_FORM_HAS_FIELDS],
    # TODO: Add _PRIORITY_CONFIGURED guard here once priority configuration exists.
    # The guard should verify that the market's setup_object has at least one
    # priority entry (enum_priority_order is populated) before assignment can begin.
    "assignment": [_ALL_REVIEWED],
    "offers": [_NO_APPROVED],
}

# (from_phase, to_phase) -> list of guard instances. This is the table evaluate_transition
# reads; the map above only states which guards every edge into a phase is obliged to carry.
# Transitions in VALID_TRANSITIONS but absent here have no preconditions
# (admin authority -- the organiser decides when to advance).
# ADDING A GUARD = append to the list. REMOVING = delete from the list.
# No other file changes. Not the endpoint. Not the frontend.
#
# Keyed by edge, not by target phase, because a precondition can be specific to the route:
# "cannot reopen applications once assignments are published" is a rule about
# applications_closed -> applications_open and is meaningless on draft -> applications_open.
# An edge carries its phase's entry invariants PLUS whatever else that route demands.
TRANSITION_GUARDS: dict[tuple[str, str], list] = {
    ("draft", "applications_open"): [_FORM_HAS_FIELDS],
    ("applications_closed", "applications_open"): [_FORM_HAS_FIELDS],
    # TODO: Add _PRIORITY_CONFIGURED guard here (append to list) once it exists.
    # The guard should verify that the market's setup_object has at least one
    # priority entry before assignment can begin.
    ("review", "assignment"): [_ALL_REVIEWED],
    ("assignment", "offers"): [_NO_APPROVED],
}


# ── Registry self-check ─────────────────────────────────────────────────


def _validate_registry() -> None:
    """Fail at import if the tables above disagree.

    All three tables are hand-maintained and keyed by bare strings, and every way of
    getting them out of sync fails silently at runtime: a guard listed on an edge that
    does not exist never runs, a phase misspelled in ``PHASE_ENTRY_INVARIANTS`` makes the
    lookup below return an empty list so the phase's invariant is dropped without a word,
    and an edge that simply forgot an invariant reports no blockers. Editing this file is
    only safe if the file catches all of them, so it checks them here rather than trusting
    a reviewer to.
    """
    known_phases = {phase.value for phase in MarketPhase}

    misspelled_edges = {
        (from_phase, to_phase)
        for from_phase, to_phase in VALID_TRANSITIONS
        if from_phase not in known_phases or to_phase not in known_phases
    }
    if misspelled_edges:
        raise RuntimeError(
            "VALID_TRANSITIONS names phases that are not MarketPhase members: "
            f"{sorted(misspelled_edges)}. An edge nothing can reach is a transition that "
            "always 400s."
        )

    unreachable = set(TRANSITION_GUARDS) - VALID_TRANSITIONS
    if unreachable:
        raise RuntimeError(
            "TRANSITION_GUARDS lists edges that are not in VALID_TRANSITIONS: "
            f"{sorted(unreachable)}. Guards on an edge that cannot be taken never run."
        )

    entered_phases = {to_phase for _, to_phase in VALID_TRANSITIONS}
    undeclarable = set(PHASE_ENTRY_INVARIANTS) - entered_phases
    if undeclarable:
        raise RuntimeError(
            "PHASE_ENTRY_INVARIANTS declares invariants for phases no transition enters: "
            f"{sorted(undeclarable)}. Entry invariants are enforced on the edges into a "
            "phase, so a phase with no inbound edge in VALID_TRANSITIONS - a misspelled one, "
            "most likely - has its invariants silently dropped."
        )

    for from_phase, to_phase in sorted(VALID_TRANSITIONS):
        required = {guard.id for guard in PHASE_ENTRY_INVARIANTS.get(to_phase, [])}
        enforced = {guard.id for guard in TRANSITION_GUARDS.get((from_phase, to_phase), [])}
        missing = required - enforced
        if missing:
            raise RuntimeError(
                f"Edge {from_phase} -> {to_phase} does not enforce the entry invariants of "
                f"'{to_phase}': {sorted(missing)}. An entry invariant holds of every market in "
                "the phase, so every edge into it must carry the guard - otherwise the "
                "invariant only holds on the route the author happened to think about. "
                "(An edge may enforce further guards of its own; only the floor is checked.)"
            )


_validate_registry()


# ── Evaluation helpers ──────────────────────────────────────────────────


def evaluate_transition(
    market: Market, to_phase: str, db
) -> list[PreconditionResult]:
    """Evaluate all guards for a transition. Returns only FAILED results.

    If the transition has no guards, returns an empty list (no blockers).
    Callers use this to build the 409 blocker list or confirm success.
    """
    key = (market.phase.value, to_phase)
    guards = TRANSITION_GUARDS.get(key, [])
    blockers: list[PreconditionResult] = []
    for guard in guards:
        result = guard.evaluate(market, db)
        if not result.passed:
            blockers.append(result)
    return blockers
