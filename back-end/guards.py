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
from typing import Any, Dict, List, Optional

import api.applications as ApplicationsApi
from datatypes import ApplicationStatus, Market, MarketPhase
from essential_fields import (
    TIER_PREFERENCE_KEY,
    effective_essential_options_for_market,
    plan_derived_asked_keys,
)


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
    """The application form must ask the applicant something before applications open.

    There are two ways to ask, and this guard counts both.

    A market's *custom* fields live in ``ApplicationForm.fields``. Its *essential* questions do
    not: they are purpose-built components whose offering is derived from the market plan
    (``essential_fields``), and they are deliberately kept out of that list. Counting only the
    list therefore judged a form that asks every question the solver reads to be empty, and the
    organizer's only way past this guard was to add a custom field they did not want. That was a
    pre-existing bug; a market whose intake is the essential questions alone is the first thing
    to meet it.

    "The essential questions ask something" is not "the market has a form". It is
    ``asked_essential_keys``, the one statement of which questions an offering actually asks --
    the same rule that decides what an applicant is shown and what the solver requires of them.
    A question with nothing to offer is not asked, so a market with no dates, no tiers and fewer
    than two sections genuinely asks nothing, and is genuinely blocked.

    It counts the PLAN-DERIVED questions only (``plan_derived_asked_keys``), which excludes the
    applicant's name. The name is asked unconditionally, so counting it would mean the essential
    count is never zero and this guard could never fail again -- and what it is holding is the last
    thing stopping an organizer collecting applications for a market that cannot place anyone.
    Excluding identity keeps it meaning exactly what the paragraph above says it means.
    """

    id: str = "form_has_fields"
    description: str = "Application form asks at least one question"

    def evaluate(self, market: Market, db) -> PreconditionResult:
        form = market.application_form
        custom_fields = 0 if form is None else len(form.fields)
        essential_questions = len(
            plan_derived_asked_keys(effective_essential_options_for_market(market))
        )
        if custom_fields == 0 and essential_questions == 0:
            return PreconditionResult(
                id=self.id,
                passed=False,
                message=(
                    "The application form asks nothing. "
                    "Add market dates, tiers or sections so the form can ask the essential "
                    "questions, or add a custom field, before opening applications."
                ),
                resolution_link="/market-setup",
            )
        return PreconditionResult(id=self.id, passed=True, message="")


class NoApplicationsYetGuard:
    """A market may return to draft only while nobody has applied.

    The form is editable in ``draft`` alone, importing is permitted only in ``applications_open``,
    and nothing returned to ``draft`` - so every custom field had to be anticipated before the
    organizer had ever seen their own columns, and opening applications froze the form for good.
    This edge is the way back, and this guard is what keeps it from being a hole in D9.

    It is not redundant with the D9 check in ``application_form_lock_reason``. That check runs when
    the form is written; this one runs when the market moves. Applicant submission is gated to
    ``applications_open``, so a count of zero is *stable* in ``draft`` and a read-then-write race
    while applications are open - going back is what makes the form check race-free, so the going
    back is what has to be gated.

    Once one application exists the market cannot return, and the form is frozen for good exactly
    as it was before this edge existed.
    """

    id: str = "no_applications_yet"
    description: str = "No applications have been submitted yet"

    def evaluate(self, market: Market, _db) -> PreconditionResult:
        count = ApplicationsApi.count_applications_for_market(market.id)
        if count > 0:
            app_word = "application has" if count == 1 else "applications have"
            return PreconditionResult(
                id=self.id,
                passed=False,
                message=(
                    f"{count} {app_word} already been submitted, so this market cannot return to "
                    "draft. The application form is frozen once anyone has answered it."
                ),
                resolution_link=None,
            )
        return PreconditionResult(id=self.id, passed=True, message="")


class AssignmentComputedGuard:
    """A market cannot go live until the solver has actually placed someone.

    Publishing is what puts the public check-in URL on the air, and a market with no computed
    assignment serves a page that can tell nobody where to stand.

    This is an ENTRY INVARIANT on ``market_days`` rather than a guard on one edge: it is a property
    of sitting in the phase, whatever route got you there, so a second route added later cannot
    bypass it.

    It reads ``assignmentObject.vendorAssignments`` because that is what the solver actually writes.
    The cautionary example is in this same file: ``offers`` has an entry invariant and is deadlocked
    precisely because that invariant waits on statuses nothing ever sets.
    """

    id: str = "assignment_computed"
    description: str = "An assignment has been computed"

    def evaluate(self, market: Market, _db) -> PreconditionResult:
        assignment = market.assignment_object
        placements = getattr(assignment, "vendor_assignments", None) or []
        if not placements:
            return PreconditionResult(
                id=self.id,
                passed=False,
                message=(
                    "No assignment has been computed for this market, so its check-in page could "
                    "not tell anyone where to stand. Run the assignment first."
                ),
                resolution_link="/assignment-results",
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
    # The way back, so a form can be corrected before anyone has answered it (E03/F04). Guarded on
    # no application existing; only this phase may return, because a market that has closed
    # applications or begun review has moved past the point where its form is a draft of anything.
    ("applications_open", "draft"),
    ("applications_open", "applications_closed"),
    ("applications_closed", "applications_open"),
    ("applications_closed", "review"),
    ("review", "applications_closed"),
    # Assignment and forward
    ("review", "assignment"),
    ("assignment", "offers"),
    # Publishing (E03/F03). market_days already meant "the market is running" and was stranded
    # behind the deadlocked assignment -> offers; this is the route that reaches it.
    ("assignment", "market_days"),
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

class NoAskedForTierWithoutTablesGuard:
    """No approved applicant may be waiting on a tier the plan gives no tables to.

    Tables are generated from sections and a section carries one tier, so a tier with no section
    has no tables on any date. An approved application naming that tier is a guaranteed rejection:
    the solver will refuse to place them, correctly, and the organizer finds out afterwards from a
    payoff screen reporting free tables beside unplaced vendors. That is the finding E12 exists to
    answer, and this is the half of it that stops it happening rather than explaining it.

    **An empty tier nobody asked for does not block.** A tier the organizer declared and has not
    built out yet is harmless - the plan editor marks it, and that is the right weight for it. What
    is not harmless is five approved applicants waiting on it.

    The message names the tier and the applicants, because both fixes are things the organizer does
    to a named thing: add a section at that tier, or reject those applications. A count alone tells
    them neither.
    """

    id: str = "no_asked_for_tier_without_tables"
    description: str = "Every tier an approved applicant named has tables"

    def evaluate(self, market: Market, _db) -> PreconditionResult:
        setup = market.setup_object
        if setup is None:
            return PreconditionResult(id=self.id, passed=True, message="")

        with_tables = {
            section.tier.name
            for section in setup.sections
            if section.count > 0 and section.tier and section.tier.name
        }
        empty_tiers = {
            tier.name for tier in setup.tiers if tier.name and tier.name not in with_tables
        }
        if not empty_tiers:
            return PreconditionResult(id=self.id, passed=True, message="")

        # Who is waiting on one, read from the approved applications themselves.
        waiting: Dict[str, List[str]] = {}
        approved = ApplicationsApi.list_applications_with_status(
            market.id, ApplicationStatus.REVIEWER_APPROVED.value,
        )
        for document in approved:
            answers = document.get("form_data") or {}
            named = _tiers_named_by(answers)
            email = str(document.get("applicant_email") or "").strip()
            for tier in sorted(named & empty_tiers):
                waiting.setdefault(tier, []).append(email or "(no email)")

        if not waiting:
            return PreconditionResult(id=self.id, passed=True, message="")

        parts = [
            f"{tier} ({', '.join(sorted(set(applicants)))})"
            for tier, applicants in sorted(waiting.items())
        ]
        tier_word = "tier has" if len(parts) == 1 else "tiers have"
        return PreconditionResult(
            id=self.id,
            passed=False,
            message=(
                f"{len(parts)} {tier_word} no tables, and approved applicants are waiting on "
                f"them: {'; '.join(parts)}. Add a section at that tier, or reject those "
                f"applications, before assigning."
            ),
            resolution_link="/market-setup",
        )


def _tiers_named_by(answers: Dict[str, Any]) -> set:
    """Every tier this application accepts, across every date it names.

    The answer is stored per date (E01/F05), so this flattens it: a tier with no tables is a
    problem on whichever day they offered it.
    """
    stored = answers.get(TIER_PREFERENCE_KEY)
    if isinstance(stored, dict):
        named = set()
        for tiers in stored.values():
            named.update(str(tier) for tier in (tiers or []))
        return named
    if isinstance(stored, list):
        return {str(tier) for tier in stored}
    return set()


# Guards are stateless, so one instance is shared by every edge that enforces it.
_FORM_HAS_FIELDS = FormHasFieldsGuard()
_ALL_REVIEWED = AllApplicationsReviewedGuard()
_NO_APPLICATIONS_YET = NoApplicationsYetGuard()
_ASSIGNMENT_COMPUTED = AssignmentComputedGuard()
_NO_APPROVED = NoApprovedApplicationsGuard()
_NO_EMPTY_TIER_ASKED_FOR = NoAskedForTierWithoutTablesGuard()

# Entry invariants: what must hold of a market SITTING IN a phase, regardless of the
# route it took to get there. Every inbound edge to the phase must enforce these, so
# listing one here makes it impossible to reach the phase without it.
PHASE_ENTRY_INVARIANTS: dict[str, list] = {
    "applications_open": [_FORM_HAS_FIELDS],
    # TODO: Add _PRIORITY_CONFIGURED guard here once it is decided whether a market must
    # have any priority rule at all. A rule now names a form question and carries its own
    # ordering, so the check would be that every rule has a target and a non-empty ordering -
    # a half-built rule scores every vendor alike, which is silent rather than wrong.
    "assignment": [_ALL_REVIEWED],
    "offers": [_NO_APPROVED],
    "market_days": [_ASSIGNMENT_COMPUTED],
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
    ("applications_open", "draft"): [_NO_APPLICATIONS_YET],
    ("review", "assignment"): [_ALL_REVIEWED, _NO_EMPTY_TIER_ASKED_FOR],
    ("assignment", "offers"): [_NO_APPROVED],
    ("assignment", "market_days"): [_ASSIGNMENT_COMPUTED],
    ("offers", "market_days"): [_ASSIGNMENT_COMPUTED],
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
