"""Centralized guard registry for market phase transitions (D16).

Every precondition for every phase transition lives in this single file.
Each guard bundles its ``id``, ``description``, and ``evaluate()`` method.
Adding or removing a precondition edits ONLY this file -- the endpoint and
frontend never change.

Design: guards are plain Python classes, not a rules engine (D16 refined).
No ABC, no DSL, no runtime mutation. Read this file to understand every
precondition in the system.

The edges and their guards are the tables at the foot of this file; ``_validate_registry`` refuses
tables that disagree.
"""

from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

import api.applications as ApplicationsApi
from assignment.utils import convert_keys_to_camel_case
from datatypes import ApplicationStatus, IntakeMode, Market, MarketPhase
from essential_fields import (
    TIER_PREFERENCE_KEY,
    effective_essential_options_for_market,
    plan_derived_asked_keys,
)
from placement_reasons import orphaned_pins
import pricing as Pricing


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
    #: Where the fix is made, as a page of THIS market: relative to ``/markets/<id>/``, which the
    #: front end prefixes (E21/F02/S02), so a guard never builds a per-market URL. It names the page
    #: that holds the remedy (``applications``); every market page has its own address since
    #: E22/F04/S02, so a link to one leads there from anywhere but that page itself. ``None`` when
    #: the remedy spans two places - the panel would rather say nothing than send the organizer to
    #: one of two, having named both in the message (E14/F01/S03). Do not point it at a redirect:
    #: the panel compares this against the current location to decide whether it leads anywhere,
    #: and cannot follow a hop.
    resolution_link: Optional[str] = None
    #: What following the link does, in a few words the organizer acts on ("Add a location"). The
    #: rail draws it as its main button while the move waits on this (E32/F01/S02), so a link always
    #: has one and words never come without a link: both or neither, refused at construction.
    resolution_label: Optional[str] = None
    #: The row of the market's actions table (``api/market_actions.py``) that the remedy takes
    #: ("change-setup"). The rail and its panel offer the link only to someone the table lets take
    #: that action (T142), so a link always names one and an action never comes without a link:
    #: both or neither, refused at construction. That it is a row of the table is held by a test
    #: rather than here, for the reason the links are (``TestEveryResolutionLinkPointsAtItsFix``).
    resolution_action: Optional[str] = None

    def __post_init__(self) -> None:
        if self.resolution_link and not self.resolution_label:
            raise ValueError(f"{self.id}: a resolution_link needs a resolution_label to name it")
        if self.resolution_label and not self.resolution_link:
            raise ValueError(f"{self.id}: a resolution_label needs a resolution_link to lead to")
        if self.resolution_link and not self.resolution_action:
            raise ValueError(f"{self.id}: a resolution_link needs the resolution_action it takes")
        if self.resolution_action and not self.resolution_link:
            raise ValueError(f"{self.id}: a resolution_action needs a resolution_link to lead to")

    def payload(self) -> Dict[str, Any]:
        """As the wire carries it: the one shape the transition's refusal and the market read's
        ``transitionBlockers`` both serve."""
        return convert_keys_to_camel_case(asdict(self))


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
                # Two remedies, two tabs: the plan is Market Setup, a custom field is Application
                # Form. The message names both; a link could only name one.
                resolution_link=None,
            )
        return PreconditionResult(id=self.id, passed=True, message="")


# ── The setup is complete before it settles (E31/F01/S01) ───────────────
#
# Leaving draft settles the setup: nothing on Market Setup changes after it. A setup that leaves
# incomplete can therefore never be completed, so leaving draft asks for each part of it - each its
# own guard, so each missing part is its own line, and each pointing at Market Setup.


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


# The furthest west a clock is set: Baker Island keeps UTC-12, so a day there ends last.
_LAST_DAY_TO_END = timedelta(hours=12)


def _earliest_calendar_day() -> str:
    """The earliest calendar day anywhere on Earth, as a market date (``YYYY-MM-DD``).

    A market's date is a day where the market is, and the server does not know where that is. So a
    date has passed only once it has passed everywhere: the server never refuses a date that is
    still today for some organizer, and a refusal is one the viewer's own calendar - which the rail
    and the door read (``calendarToday`` in ``front-end/src/utils/marketGuide.ts``) - agrees with.
    """
    return (_utc_now() - _LAST_DAY_TO_END).date().isoformat()


class SetupHasDatesGuard:
    """The market has dates, and none of them has already passed.

    A date that has passed cannot be applied for, and a CSV start reads its year from a past file:
    the walk opened, ran and published a market dated a year back without a word.
    """

    id: str = "setup_has_dates"
    description: str = "The market has dates, none of them passed"

    def evaluate(self, market: Market, _db) -> PreconditionResult:
        setup = market.setup_object
        dates = sorted({d.date for d in setup.market_dates}) if setup else []
        if not dates:
            return PreconditionResult(
                id=self.id, passed=False,
                resolution_link="setup", resolution_label="Pick market dates",
                resolution_action="change-setup",
                message="This market has no market dates. Pick them on Market Setup's calendar.",
            )
        earliest = _earliest_calendar_day()
        passed = [date for date in dates if date < earliest]
        if passed:
            return PreconditionResult(
                id=self.id, passed=False,
                resolution_link="setup", resolution_label="Change the dates",
                resolution_action="change-setup",
                message=(
                    f"{len(passed)} of this market's dates "
                    f"{'has' if len(passed) == 1 else 'have'} already passed: "
                    f"{', '.join(passed)}. Change them on Market Setup."
                ),
            )
        return PreconditionResult(id=self.id, passed=True, message="")


class SetupHasALocationGuard:
    """The market says where it is."""

    id: str = "setup_has_a_location"
    description: str = "The market has a location"

    def evaluate(self, market: Market, _db) -> PreconditionResult:
        setup = market.setup_object
        if setup and any(location.name.strip() for location in setup.locations):
            return PreconditionResult(id=self.id, passed=True, message="")
        return PreconditionResult(
            id=self.id, passed=False,
            resolution_link="setup", resolution_label="Add a location",
            resolution_action="change-setup",
            message="This market has no location. Add one on Market Setup.",
        )


class EveryTierHasTablesGuard:
    """There are tables, and every tier has some.

    A tier is a price, and its tables are its sections'. A tier with no section of tables is one
    an applicant can choose and nobody can be placed at; the walk met it in review as a blocker
    listing every applicant waiting on it (``NoAskedForTierWithoutTablesGuard``). Said here, in
    draft, it is about the plan and names the tier.
    """

    id: str = "every_tier_has_tables"
    description: str = "Every tier has a section with tables"

    def evaluate(self, market: Market, _db) -> PreconditionResult:
        setup = market.setup_object
        sections = [s for s in (setup.sections if setup else []) if s.count > 0]
        if not sections:
            return PreconditionResult(
                id=self.id, passed=False,
                resolution_link="setup", resolution_label="Add tables",
                resolution_action="change-setup",
                message="This market has no tables yet. Add a section with tables on Market Setup.",
            )
        with_tables = {s.tier.name for s in sections if s.tier and s.tier.name}
        bare = [
            t.name for t in (setup.tiers if setup else []) if t.name and t.name not in with_tables
        ]
        if bare:
            return PreconditionResult(
                id=self.id, passed=False,
                resolution_link="setup", resolution_label="Give every tier tables",
                resolution_action="change-setup",
                message=(
                    f"{'Tier' if len(bare) == 1 else 'Tiers'} {', '.join(bare)} "
                    f"{'has' if len(bare) == 1 else 'have'} no tables. Give each a section with "
                    "tables on Market Setup, or remove it."
                ),
            )
        return PreconditionResult(id=self.id, passed=True, message="")


class PriceGroupsStandGuard:
    """Every price group's conditions name a question the form asks, and answers it offers.

    A group's condition on a question taken off the form, or on an answer no longer offered, prices
    nobody, so its members would pay "Everyone else" without a word. The prices settle on leaving
    draft with the rest of the setup, and the form with them, so this is the last moment it can be
    fixed (E43/F01/S02). One line names every broken group.
    """

    id: str = "price_groups_stand"
    description: str = "Every price group's conditions are on the form"

    def evaluate(self, market: Market, _db) -> PreconditionResult:
        broken = Pricing.Groups(market).broken()
        if not broken:
            return PreconditionResult(id=self.id, passed=True, message="")
        names = ", ".join(f"“{name}”" for name in broken)
        many = len(broken) > 1
        return PreconditionResult(
            id=self.id, passed=False,
            resolution_link="setup", resolution_label="Fix the price groups",
            resolution_action="change-setup",
            message=(
                f"The price {'groups' if many else 'group'} {names} "
                f"{'have' if many else 'has'} a condition on a question or an answer the form no "
                "longer asks. Change or remove it on Market Setup's Pricing card."
            ),
        )


class NoApplicationsYetGuard:
    """A market may return to draft only while nobody has applied.

    The form is editable in ``draft`` alone, and nothing returned to ``draft`` - so every custom
    field had to be anticipated before the organizer had ever seen their own answers, and opening
    applications froze the form for good. This edge is the way back, and this guard is what keeps it
    from being a hole in D9.

    It is not redundant with the D9 check in ``application_form_lock_reason``. That check runs when
    the form is written; this one runs when the market moves. Applicant submission is gated to
    ``applications``, so a count of zero is *stable* in ``draft`` and a read-then-write race while
    applications are open - going back is what makes the form check race-free, so the going back is
    what has to be gated.

    Once one application exists the market cannot return, and the form is frozen for good exactly
    as it was before this edge existed.
    """

    id: str = "no_applications_yet"
    description: str = "No applications have been submitted yet"

    def evaluate(self, market: Market, _db) -> PreconditionResult:
        count = ApplicationsApi.count_applications_for_market(market.id)
        if count > 0:
            app_word = "application is" if count == 1 else "applications are"
            # In words true of both paths: an imported row was never "submitted" here (E32/F02/S01).
            return PreconditionResult(
                id=self.id,
                passed=False,
                message=(
                    f"{count} {app_word} already in, so this market cannot return to draft. The "
                    "questions are fixed once anyone has applied or been imported."
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
    description: str = "Tables have been allocated"

    def evaluate(self, market: Market, _db) -> PreconditionResult:
        assignment = market.assignment_object
        placements = getattr(assignment, "vendor_assignments", None) or []
        if not placements:
            return PreconditionResult(
                id=self.id,
                passed=False,
                message=(
                    "No tables have been allocated for this market, so its check-in page could "
                    "not tell anyone where to stand. Allocate tables first."
                ),
                resolution_link="settings",
                resolution_label="Allocate tables",
                resolution_action="assign",
            )
        return PreconditionResult(id=self.id, passed=True, message="")


class ResultsPublishedGuard:
    """A market whose vendors apply on its page does not go live until they have been told whether
    they have a table (E36/F04/S02).

    An ENTRY INVARIANT on ``market_days``, like the assignment it follows: check-in on the air with
    applicants still reading "Submitted" was the state this closes. A CSV market has no applicant
    page and nobody to tell, so it passes. Reads the intake mode and the flag, never the phase.
    """

    id: str = "results_published"
    description: str = "Results are published to applicants"

    def evaluate(self, market: Market, _db) -> PreconditionResult:
        if market.intake_mode is not IntakeMode.FORM or market.results_published:
            return PreconditionResult(id=self.id, passed=True, message="")
        return PreconditionResult(
            id=self.id,
            passed=False,
            message=(
                "Applicants have not been told whether they have a table. Publish the results "
                "before the market goes live."
            ),
            resolution_link="applications",
            resolution_label="Publish results",
            resolution_action="publish-results",
        )


class AllApplicationsReviewedGuard:
    """Every application must be approved or rejected before assignment can begin.

    No application may still be ``open``, ``under_review`` or ``needs_follow_up`` -- the review
    phase must have reached a verdict on every single one.
    """

    id: str = "all_applications_reviewed"
    description: str = "Every application is approved or rejected"

    def evaluate(self, market: Market, _db) -> PreconditionResult:
        total = ApplicationsApi.count_applications_for_market(market.id)
        unreviewed_count = ApplicationsApi.count_applications_with_any_status(
            market.id,
            [ApplicationStatus.OPEN.value, ApplicationStatus.UNDER_REVIEW.value],
        )
        following_up = ApplicationsApi.count_applications_with_any_status(
            market.id, [ApplicationStatus.NEEDS_FOLLOW_UP.value],
        )
        if unreviewed_count > 0 or following_up > 0:
            waiting = []
            if unreviewed_count:
                waiting.append(f"{unreviewed_count} application"
                               f"{' is' if unreviewed_count == 1 else 's are'} still awaiting review")
            # Named apart, so the organizer knows to chase them (E34/F02/S01).
            if following_up:
                waiting.append(f"{following_up} application"
                               f"{' needs' if following_up == 1 else 's need'} a follow-up")
            return PreconditionResult(
                id=self.id,
                passed=False,
                message=(
                    f"{' and '.join(waiting)}. Every application must be approved or rejected "
                    "before the market can enter Assignment."
                ),
                resolution_link="applications",
                resolution_label="Finish deciding",
                resolution_action="give-verdicts",
            )
        if total == 0:
            return PreconditionResult(
                id=self.id,
                passed=False,
                message=(
                    "There are no applications for this market. "
                    "At least one application must exist before the market can enter Assignment."
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
                    "assigned or unassigned. Allocate tables before "
                    "sending offers."
                ),
                resolution_link="settings",
                resolution_label="Allocate tables",
                resolution_action="assign",
            )
        return PreconditionResult(id=self.id, passed=True, message="")


class ResponsesImportedGuard:
    """A Google Form market has imported its responses before it enters Review (E38/F04/S01).

    On that path the import is the collection, and its first commit is the way into the stage: the
    import takes this move itself once the rows are written (``csv_import.import_applications``), so
    the rail's step from draft is this guard's fix, "Import responses", and a market left mid-import
    stays a draft. A market whose vendors apply on its own page is not asked - nobody imports into
    one, and opening applications is its way in.
    """

    id: str = "responses_imported"
    description: str = "A Google Form market has imported its responses"

    def evaluate(self, market: Market, _db) -> PreconditionResult:
        if market.intake_mode is not IntakeMode.CSV:
            return PreconditionResult(id=self.id, passed=True, message="")
        if ApplicationsApi.count_applications_for_market(market.id) > 0:
            return PreconditionResult(id=self.id, passed=True, message="")
        return PreconditionResult(
            id=self.id, passed=False,
            resolution_link="import", resolution_label="Import responses",
            resolution_action="import-applications",
            message="Nothing has been imported yet. Import your Google Form's responses first.",
        )


# ── Transition registry ─────────────────────────────────────────────────


# Transitions not in this set return 400 ("transition not available in current phase").
# Adding a new phase transition: add to this set + add to TRANSITION_GUARDS
# if the transition has preconditions.
VALID_TRANSITIONS: set[tuple[str, str]] = {
    # Into the stage where applications arrive and are reviewed (E38/F04/S01): an own-form market
    # by opening applications, a Google Form market by its first import, which takes this move.
    ("draft", "applications"),
    # The way back, so a form can be corrected before anyone has answered it (E03/F04). Guarded on
    # no application existing.
    ("applications", "draft"),
    # Assignment and forward. Entering it closes the applicant form: applying is the stage's alone.
    ("applications", "assignment"),
    ("assignment", "offers"),
    # Publishing (E03/F03). market_days already meant "the market is running" and was stranded
    # behind the deadlocked assignment -> offers; this is the route that reaches it.
    ("assignment", "market_days"),
    ("offers", "market_days"),
    # Archive from anywhere
    ("draft", "archived"),
    ("applications", "archived"),
    ("assignment", "archived"),
    ("offers", "archived"),
    ("market_days", "archived"),
}


def route_between(from_phase: str, to_phase: str) -> Optional[List[str]]:
    """The shortest route of existing transitions between two phases, archiving excluded.

    The phases entered on the way, ``[]`` when the two are the same phase, or None when there is no
    route. A breadth-first walk of ``VALID_TRANSITIONS``, so no caller states a route of its own: an
    edge added or removed above changes every route with no edit anywhere else. Archiving is left
    out because it is terminal - a route through it ends the market rather than getting anywhere.
    """
    queue: List[tuple[str, List[str]]] = [(from_phase, [])]
    seen = {from_phase}
    while queue:
        at, path = queue.pop(0)
        if at == to_phase:
            return path
        for source, target in sorted(VALID_TRANSITIONS):
            if source != at or target in seen or target == MarketPhase.ARCHIVED.value:
                continue
            seen.add(target)
            queue.append((target, path + [target]))
    return None


def moves_from(phase: str) -> List[str]:
    """Every phase a market standing in ``phase`` may move to: one edge of the table each."""
    return sorted(target for source, target in VALID_TRANSITIONS if source == phase)


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
            answers = ApplicationsApi.effective_answers(document)
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
                f"applications, before allocating tables."
            ),
            # Add a section at that tier is Market Setup; reject those applications is
            # Applications. Naming one would quietly recommend it over the other.
            resolution_link=None,
        )


class NoOrphanedPinGuard:
    """No hand placement may name a seat the plan no longer has.

    A pin is a deliberate guarantee - "this vendor gets that spot" - and the plan can outlive it:
    delete the section, or drop its table count below the pinned number, and the seat is gone.
    Three answers were possible and two are worse. Deleting the pin loses the guarantee with
    nobody told. Refusing the plan edit makes pins a lock on the floor plan, and an organizer
    rearranging their room should not be blocked by a decision they can revisit. So the pin is
    orphaned and the reckoning is deferred to the next assignment - the moment they were going to
    look anyway, and a moment that already renders blockers generically.

    The message names the vendor and the seat, because both ways out are things the organizer
    does to a named thing: put the seat back in the plan, move the vendor, or free their seat.
    """

    id: str = "no_orphaned_pin"
    description: str = "Every hand-assigned vendor's seat still exists in the plan"

    def evaluate(self, market: Market, _db) -> PreconditionResult:
        orphans = orphaned_pins(
            market.setup_object, market.assignment_object.vendor_assignments or [],
        )
        if not orphans:
            return PreconditionResult(id=self.id, passed=True, message="")

        named = "; ".join(
            f"{pin.email} at {pin.table_code} on {pin.date}"
            for pin in sorted(orphans, key=lambda pin: (pin.date, pin.table_code, pin.email))
        )
        pin_word = "assignment names a seat" if len(orphans) == 1 else "assignments name seats"
        return PreconditionResult(
            id=self.id,
            passed=False,
            message=(
                f"{len(orphans)} hand {pin_word} the plan no longer has: {named}. "
                "Restore the seat in the plan, or move or free those vendors."
            ),
            # Two remedies again, on two pages: restoring the seat is Market Setup, and moving a
            # vendor is the Assignments page. This used to say `?tab=assignment`, which holds
            # neither.
            resolution_link=None,
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
_SETUP_HAS_DATES = SetupHasDatesGuard()
_SETUP_HAS_A_LOCATION = SetupHasALocationGuard()
_EVERY_TIER_HAS_TABLES = EveryTierHasTablesGuard()
_PRICE_GROUPS_STAND = PriceGroupsStandGuard()
_ALL_REVIEWED = AllApplicationsReviewedGuard()
_NO_APPLICATIONS_YET = NoApplicationsYetGuard()
_ASSIGNMENT_COMPUTED = AssignmentComputedGuard()
_RESULTS_PUBLISHED = ResultsPublishedGuard()
_NO_APPROVED = NoApprovedApplicationsGuard()
_NO_EMPTY_TIER_ASKED_FOR = NoAskedForTierWithoutTablesGuard()
_NO_ORPHANED_PIN = NoOrphanedPinGuard()
_RESPONSES_IMPORTED = ResponsesImportedGuard()

# Entry invariants: what must hold of a market SITTING IN a phase, regardless of the
# route it took to get there. Every inbound edge to the phase must enforce these, so
# listing one here makes it impossible to reach the phase without it.
PHASE_ENTRY_INVARIANTS: dict[str, list] = {
    # A Google Form market enters with its responses imported, which its first import guarantees by
    # taking the move only after writing them.
    "applications": [_FORM_HAS_FIELDS, _RESPONSES_IMPORTED],
    # TODO: Add _PRIORITY_CONFIGURED guard here once it is decided whether a market must
    # have any priority rule at all. A rule now names a form question and carries its own
    # ordering, so the check would be that every rule has a target and a non-empty ordering -
    # a half-built rule scores every vendor alike, which is silent rather than wrong.
    "assignment": [_ALL_REVIEWED, _NO_ORPHANED_PIN],
    "offers": [_NO_APPROVED],
    # A market that is already in assignment never re-enters it, so an orphaned pin made there -
    # a seat dropped from the plan after the run - met no guard and was published (bug 31).
    "market_days": [_ASSIGNMENT_COMPUTED, _NO_ORPHANED_PIN, _RESULTS_PUBLISHED],
}

# (from_phase, to_phase) -> list of guard instances. This is the table evaluate_transition
# reads; the map above only states which guards every edge into a phase is obliged to carry.
# Transitions in VALID_TRANSITIONS but absent here have no preconditions
# (admin authority -- the organiser decides when to advance).
# ADDING A GUARD = append to the list. REMOVING = delete from the list.
# No other file changes. Not the endpoint. Not the frontend.
#
# Keyed by edge, not by target phase, because a precondition can be specific to the route.
# An edge carries its phase's entry invariants PLUS whatever else that route demands.
TRANSITION_GUARDS: dict[tuple[str, str], list] = {
    # The setup's three first, so the rail offers what Market Setup lacks before the import: a
    # Google Form market's first import judges this edge less its own guard before it writes.
    ("draft", "applications"): [
        _SETUP_HAS_DATES, _SETUP_HAS_A_LOCATION, _EVERY_TIER_HAS_TABLES, _PRICE_GROUPS_STAND,
        _FORM_HAS_FIELDS, _RESPONSES_IMPORTED,
    ],
    # TODO: Add _PRIORITY_CONFIGURED guard here (append to list) once it exists.
    # The guard should verify that the market's setup_object has at least one
    # priority entry before assignment can begin.
    ("applications", "draft"): [_NO_APPLICATIONS_YET],
    ("applications", "assignment"): [_ALL_REVIEWED, _NO_EMPTY_TIER_ASKED_FOR, _NO_ORPHANED_PIN],
    ("assignment", "offers"): [_NO_APPROVED],
    ("assignment", "market_days"): [_ASSIGNMENT_COMPUTED, _NO_ORPHANED_PIN, _RESULTS_PUBLISHED],
    ("offers", "market_days"): [_ASSIGNMENT_COMPUTED, _NO_ORPHANED_PIN, _RESULTS_PUBLISHED],
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
    market: Market, to_phase: str, db, leaving_out: Iterable[str] = ()
) -> list[PreconditionResult]:
    """Evaluate every guard on the move's edge. Returns only FAILED results.

    An empty list when nothing refuses it, or when there is no such move - the endpoint refuses that
    before asking. Callers use this to build the 409 blocker list or confirm success. A guard reads
    the market's state, never its phase (pinned by ``test_no_guard_reads_the_phase``).

    ``leaving_out`` names guards the caller is about to satisfy itself: a Google Form market's first
    import judges the move into the stage before it writes the rows ``ResponsesImportedGuard`` waits
    on, then takes it.
    """
    skipped = set(leaving_out)
    blockers: list[PreconditionResult] = []
    for guard in TRANSITION_GUARDS.get((market.phase.value, to_phase), []):
        if guard.id in skipped:
            continue
        result = guard.evaluate(market, db)
        if not result.passed:
            blockers.append(result)
    return blockers


def transition_verdicts(market: Market, db) -> Dict[str, List[PreconditionResult]]:
    """Every move open from the market's phase, with what would refuse it - empty when nothing
    would (E31/F02/S01).

    Served on the market read, so a screen disables a move and names its blocker before the click
    rather than after it; the read is also what tells a screen which moves there are. Judged by
    ``evaluate_transition``, the very function the endpoint runs, so the read and the move can never
    disagree about one.
    """
    return {
        to_phase: evaluate_transition(market, to_phase, db)
        for to_phase in moves_from(market.phase.value)
    }
