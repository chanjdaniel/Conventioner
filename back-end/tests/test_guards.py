"""Unit tests for the guard registry and phase transition evaluation (PR 2)."""
import ast
import os
import pathlib
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

import guards
from datatypes import (
    ApplicationForm, AssignmentOptionObject, AssignmentObject, EssentialFormOptions, FormField,
    Market, MarketDateObject, MarketPhase, MarketRole, SectionObject, SetupObject, TierObject,
    VendorAssignmentResult,
)
from guards import (
    AllApplicationsReviewedGuard,
    NoAskedForTierWithoutTablesGuard,
    NoOrphanedPinGuard,
    FormHasFieldsGuard,
    NoApprovedApplicationsGuard,
    PreconditionResult,
    TRANSITION_GUARDS,
    VALID_TRANSITIONS,
    evaluate_transition,
)


def _make_market(**overrides):
    """Build a minimal valid Market for guard testing."""
    kwargs = {
        "name": "Test Market",
        "creation_date": "2025-01-01",
        "roles": {"owner-1": MarketRole.OWNER},
        "modification_list": [],
        "assignment_object": AssignmentObject(),
        **overrides,
    }
    return Market(**kwargs)


def _setup(dates=(), tiers=(), sections=()):
    """A market plan offering exactly what is named, and nothing else."""
    return SetupObject(
        priority=[],
        market_dates=[MarketDateObject(date=d) for d in dates],
        tiers=[TierObject(id=i, name=name) for i, name in enumerate(tiers)],
        locations=[],
        sections=[SectionObject(name=name, count=1) for name in sections],
        assignment_options=AssignmentOptionObject(),
    )


class TestPreconditionResult:
    def test_passed(self):
        r = PreconditionResult(id="test", passed=True, message="")
        assert r.passed is True
        assert r.id == "test"

    def test_failed_with_resolution_link(self):
        r = PreconditionResult(
            id="test",
            passed=False,
            message="Something is wrong.",
            resolution_link="/fix-it",
        )
        assert r.passed is False
        assert r.message == "Something is wrong."
        assert r.resolution_link == "/fix-it"

    def test_failed_without_resolution_link(self):
        r = PreconditionResult(
            id="deadline_passed",
            passed=False,
            message="Deadline not reached.",
        )
        assert r.resolution_link is None


class TestFormHasFieldsGuard:
    """The guard asks whether the form asks the applicant anything at all.

    Custom fields are one way to ask; the essential questions are the other, and they are
    deliberately not members of ``ApplicationForm.fields`` -- they are purpose-built components
    whose offering comes from the market plan. A form that asks every question the solver reads
    and no custom ones is a complete form, and used to be judged empty.
    """

    def test_passes_when_form_has_a_custom_field(self):
        market = _make_market(
            application_form=ApplicationForm(
                fields=[FormField(key="name", label="Name", type="text")],
            ),
        )
        result = FormHasFieldsGuard().evaluate(market, None)
        assert result.passed is True
        assert result.id == "form_has_fields"

    def test_passes_when_the_form_asks_only_essential_questions(self):
        market = _make_market(
            application_form=ApplicationForm(fields=[]),
            setup_object=_setup(dates=["2026-05-01"]),
        )
        result = FormHasFieldsGuard().evaluate(market, None)
        assert result.passed is True

    def test_passes_when_the_form_asks_essential_questions_and_no_form_exists_yet(self):
        market = _make_market(application_form=None, setup_object=_setup(dates=["2026-05-01"]))
        result = FormHasFieldsGuard().evaluate(market, None)
        assert result.passed is True

    def test_passes_when_the_form_asks_both_kinds_of_question(self):
        market = _make_market(
            application_form=ApplicationForm(
                fields=[FormField(key="name", label="Name", type="text")],
            ),
            setup_object=_setup(dates=["2026-05-01"], tiers=["Standard"]),
        )
        result = FormHasFieldsGuard().evaluate(market, None)
        assert result.passed is True

    def test_a_tier_alone_is_a_question(self):
        market = _make_market(
            application_form=ApplicationForm(fields=[]),
            setup_object=_setup(tiers=["Standard"]),
        )
        result = FormHasFieldsGuard().evaluate(market, None)
        assert result.passed is True

    def test_two_sections_alone_are_a_question(self):
        market = _make_market(
            application_form=ApplicationForm(fields=[]),
            setup_object=_setup(sections=["North", "South"]),
        )
        result = FormHasFieldsGuard().evaluate(market, None)
        assert result.passed is True

    def test_one_section_alone_is_not_a_question(self):
        """Ranking a list of one has exactly one order, so it is not asked (``asks_ranking``)."""
        market = _make_market(
            application_form=ApplicationForm(fields=[]),
            setup_object=_setup(sections=["North"]),
        )
        result = FormHasFieldsGuard().evaluate(market, None)
        assert result.passed is False

    def test_fails_when_the_form_asks_nothing(self):
        market = _make_market(application_form=None, setup_object=None)
        result = FormHasFieldsGuard().evaluate(market, None)
        assert result.passed is False

    def test_offers_no_link_because_its_two_remedies_sit_in_two_tabs(self):
        """Add dates to the plan is Market Setup; add a custom field is Application Form.

        A link can only name one of the two, which would quietly recommend it over the other. The
        message names both instead (E14/F01/S03).
        """
        market = _make_market(application_form=None, setup_object=None)
        result = FormHasFieldsGuard().evaluate(market, None)
        assert result.resolution_link is None
        assert "dates" in result.message and "custom field" in result.message

    def test_fails_when_an_empty_form_meets_an_empty_plan(self):
        market = _make_market(application_form=ApplicationForm(fields=[]), setup_object=None)
        result = FormHasFieldsGuard().evaluate(market, None)
        assert result.passed is False

    def test_the_blocker_does_not_name_a_custom_field_as_the_only_remedy(self):
        """The old message said "add at least one field", which was the workaround, not the fix.

        An organizer whose form asks nothing usually has an unconfigured market plan, and adding
        a custom field they do not want was the only way the old guard could be satisfied.
        """
        market = _make_market(application_form=None, setup_object=None)
        message = FormHasFieldsGuard().evaluate(market, None).message.lower()
        assert "date" in message

    def test_a_frozen_offering_is_what_counts_once_it_exists(self):
        """The market plan stops speaking for the form the moment an applicant has saved one."""
        market = _make_market(
            application_form=ApplicationForm(
                fields=[],
                essential_options=EssentialFormOptions(dates=["2026-05-01"]),
            ),
            setup_object=None,
        )
        result = FormHasFieldsGuard().evaluate(market, None)
        assert result.passed is True


class TestEvaluateTransition:
    def test_returns_blockers_when_guard_fails(self):
        market = _make_market(phase=MarketPhase.DRAFT, application_form=None)
        blockers = evaluate_transition(market, "applications_open", None)
        assert len(blockers) == 1
        assert blockers[0].id == "form_has_fields"
        assert blockers[0].passed is False

    def test_returns_empty_when_guard_passes(self):
        market = _make_market(
            phase=MarketPhase.DRAFT,
            application_form=ApplicationForm(
                fields=[FormField(key="name", label="Name", type="text")],
            ),
        )
        blockers = evaluate_transition(market, "applications_open", None)
        assert blockers == []

    def test_returns_empty_for_unguarded_transition(self):
        market = _make_market(phase=MarketPhase.APPLICATIONS_OPEN)
        blockers = evaluate_transition(market, "applications_closed", None)
        assert blockers == []

    def test_reopen_blocked_when_form_was_emptied(self):
        market = _make_market(
            phase=MarketPhase.APPLICATIONS_CLOSED,
            application_form=ApplicationForm(fields=[]),
        )
        blockers = evaluate_transition(market, "applications_open", None)
        assert len(blockers) == 1
        assert blockers[0].id == "form_has_fields"
        assert blockers[0].passed is False

    def test_reopen_allowed_when_form_has_fields(self):
        market = _make_market(
            phase=MarketPhase.APPLICATIONS_CLOSED,
            application_form=ApplicationForm(
                fields=[FormField(key="name", label="Name", type="text")],
            ),
        )
        blockers = evaluate_transition(market, "applications_open", None)
        assert blockers == []

    def test_returns_empty_for_nonexistent_transition(self):
        market = _make_market(phase=MarketPhase.DRAFT)
        blockers = evaluate_transition(market, "archived", None)
        assert blockers == []


class TestValidTransitions:
    def test_phase1_transitions_are_registered(self):
        assert ("draft", "applications_open") in VALID_TRANSITIONS
        assert ("applications_open", "applications_closed") in VALID_TRANSITIONS
        assert ("applications_closed", "applications_open") in VALID_TRANSITIONS

    def test_later_phase_transitions_are_registered(self):
        assert ("applications_closed", "review") in VALID_TRANSITIONS
        assert ("review", "assignment") in VALID_TRANSITIONS
        assert ("assignment", "offers") in VALID_TRANSITIONS
        assert ("offers", "market_days") in VALID_TRANSITIONS
        assert ("market_days", "archived") in VALID_TRANSITIONS

    def test_only_applications_open_may_return_to_draft(self):
        """The reverse edge exists now (E03/F04), and only from the phase right after draft.

        This used to assert no edge returned to draft at all. That made the application form
        unfixable: it is editable only in draft, importing is permitted only once applications are
        open, so every custom field had to be anticipated before the organizer had seen their own
        columns. The edge is guarded on no application existing, which is what keeps D9 intact -
        see tests/test_returning_to_draft.py.
        """
        into_draft = {frm for frm, to in VALID_TRANSITIONS if to == "draft"}

        assert into_draft == {"applications_open"}

    def test_archive_from_every_phase_is_registered(self):
        phases = [p.value for p in MarketPhase if p != MarketPhase.ARCHIVED]
        for phase in phases:
            assert (phase, "archived") in VALID_TRANSITIONS, (
                f"Missing archive edge from {phase}"
            )


class TestTransitionGuards:
    def test_draft_to_applications_open_has_form_guard(self):
        guards = TRANSITION_GUARDS.get(("draft", "applications_open"), [])
        assert len(guards) == 1
        assert isinstance(guards[0], FormHasFieldsGuard)

    def test_reopen_edge_has_form_guard(self):
        guards = TRANSITION_GUARDS.get(("applications_closed", "applications_open"), [])
        assert len(guards) == 1
        assert isinstance(guards[0], FormHasFieldsGuard)

    def test_unguarded_transitions_not_in_registry(self):
        assert ("applications_open", "applications_closed") not in TRANSITION_GUARDS

    def test_every_edge_into_applications_open_is_guarded(self):
        """The form invariant belongs to the target phase, so no edge may skip it."""
        inbound = [t for t in VALID_TRANSITIONS if t[1] == "applications_open"]
        assert inbound
        for transition in inbound:
            guard_ids = {g.id for g in TRANSITION_GUARDS.get(transition, [])}
            assert "form_has_fields" in guard_ids, (
                f"{transition} enters applications_open without FormHasFieldsGuard"
            )


class TestRegistrySelfCheck:
    """The registry has to catch every way a one-file edit can silently drop a guard."""

    BOTH_INBOUND_EDGES = {
        ("draft", "applications_open"),
        ("applications_closed", "applications_open"),
    }

    def _validate(self, monkeypatch, valid_transitions, transition_guards, entry_invariants=None):
        monkeypatch.setattr(guards, "VALID_TRANSITIONS", valid_transitions)
        monkeypatch.setattr(guards, "TRANSITION_GUARDS", transition_guards)
        monkeypatch.setattr(
            guards,
            "PHASE_ENTRY_INVARIANTS",
            {"applications_open": [FormHasFieldsGuard()]} if entry_invariants is None
            else entry_invariants,
        )
        guards._validate_registry()

    def test_shipped_registry_is_consistent(self):
        guards._validate_registry()

    def test_guard_on_a_nonexistent_edge_is_rejected(self, monkeypatch):
        """A typo'd key would otherwise park the guard on an edge nobody can take."""
        with pytest.raises(RuntimeError, match="not in VALID_TRANSITIONS"):
            self._validate(
                monkeypatch,
                {("draft", "applications_open")},
                {("draft", "application_open"): [FormHasFieldsGuard()]},
            )

    def test_inbound_edge_missing_an_entry_invariant_is_rejected(self, monkeypatch):
        """This is the reopen-edge hole: one route into a phase skipping its precondition."""
        with pytest.raises(RuntimeError, match="does not enforce the entry invariants"):
            self._validate(
                monkeypatch,
                self.BOTH_INBOUND_EDGES,
                {("draft", "applications_open"): [FormHasFieldsGuard()]},
            )

    def test_every_inbound_edge_carrying_the_invariant_is_accepted(self, monkeypatch):
        self._validate(
            monkeypatch,
            self.BOTH_INBOUND_EDGES,
            {
                ("draft", "applications_open"): [FormHasFieldsGuard()],
                ("applications_closed", "applications_open"): [FormHasFieldsGuard()],
            },
        )

    def test_invariant_declared_for_a_misspelled_phase_is_rejected(self, monkeypatch):
        """The lookup is by phase string, so a typo there drops the invariant as quietly as a
        typo'd edge does: every inbound edge passes a floor of nothing."""
        with pytest.raises(RuntimeError, match="no transition enters"):
            self._validate(
                monkeypatch,
                self.BOTH_INBOUND_EDGES,
                {
                    ("draft", "applications_open"): [],
                    ("applications_closed", "applications_open"): [],
                },
                entry_invariants={"applications_opne": [FormHasFieldsGuard()]},
            )

    def test_edge_naming_a_phase_that_does_not_exist_is_rejected(self, monkeypatch):
        with pytest.raises(RuntimeError, match="not MarketPhase members"):
            self._validate(
                monkeypatch,
                {("draft", "applications_opne")},
                {},
                entry_invariants={},
            )

    def test_edge_specific_guard_beyond_the_invariant_is_allowed(self, monkeypatch):
        """Entry invariants are a floor, not a ceiling: a route may demand more of its own.

        "Cannot reopen applications once assignments are published" is a rule about the
        reopen edge and is meaningless on draft -> applications_open, so the check must not
        insist both edges carry an identical guard list.
        """
        class _ReopenOnlyGuard:
            id = "assignments_not_published"
            description = "Assignments have not been published"

            def evaluate(self, market, db):
                return PreconditionResult(id=self.id, passed=True, message="")

        self._validate(
            monkeypatch,
            self.BOTH_INBOUND_EDGES,
            {
                ("draft", "applications_open"): [FormHasFieldsGuard()],
                ("applications_closed", "applications_open"): [
                    FormHasFieldsGuard(), _ReopenOnlyGuard(),
                ],
            },
        )


class TestGuardDesignProperties:
    def test_form_has_fields_guard_has_id_and_description(self):
        guard = FormHasFieldsGuard()
        assert guard.id == "form_has_fields"
        assert isinstance(guard.description, str)
        assert len(guard.description) > 0

    def test_adding_guard_is_only_a_dict_entry(self):
        guards = TRANSITION_GUARDS[("draft", "applications_open")]
        assert len(guards) == 1


class TestAllApplicationsReviewedGuard:
    def _market(self):
        return _make_market(
            phase=MarketPhase.REVIEW,
            application_form=ApplicationForm(
                fields=[FormField(key="name", label="Name", type="text")],
            ),
        )

    @staticmethod
    def _patch(monkeypatch, total=0, unreviewed=0):
        monkeypatch.setattr(
            guards.ApplicationsApi,
            "count_applications_for_market",
            lambda _market_id: total,
        )
        monkeypatch.setattr(
            guards.ApplicationsApi,
            "count_applications_with_any_status",
            lambda _market_id, _statuses: unreviewed,
        )

    def test_passes_when_all_apps_are_reviewed(self, monkeypatch):
        self._patch(monkeypatch, total=3, unreviewed=0)
        result = AllApplicationsReviewedGuard().evaluate(self._market(), None)
        assert result.passed is True
        assert result.id == "all_applications_reviewed"

    def test_fails_when_some_apps_are_open(self, monkeypatch):
        self._patch(monkeypatch, total=3, unreviewed=1)
        result = AllApplicationsReviewedGuard().evaluate(self._market(), None)
        assert result.passed is False
        assert "still awaiting review" in result.message.lower()

    def test_fails_when_some_apps_are_under_review(self, monkeypatch):
        self._patch(monkeypatch, total=1, unreviewed=1)
        result = AllApplicationsReviewedGuard().evaluate(self._market(), None)
        assert result.passed is False

    def test_fails_when_no_applications_exist(self, monkeypatch):
        self._patch(monkeypatch, total=0, unreviewed=0)
        result = AllApplicationsReviewedGuard().evaluate(self._market(), None)
        assert result.passed is False
        assert "no applications" in result.message.lower()

    def test_has_id_and_description(self):
        guard = AllApplicationsReviewedGuard()
        assert guard.id == "all_applications_reviewed"
        assert isinstance(guard.description, str)
        assert len(guard.description) > 0


class TestNoApprovedApplicationsGuard:
    def _market(self):
        return _make_market(
            phase=MarketPhase.ASSIGNMENT,
            application_form=ApplicationForm(
                fields=[FormField(key="name", label="Name", type="text")],
            ),
        )

    @staticmethod
    def _patch(monkeypatch, approved_count=0):
        monkeypatch.setattr(
            guards.ApplicationsApi,
            "count_applications_with_status",
            lambda _market_id, _status: approved_count,
        )

    def test_passes_when_no_apps_are_approved(self, monkeypatch):
        self._patch(monkeypatch, approved_count=0)
        result = NoApprovedApplicationsGuard().evaluate(self._market(), None)
        assert result.passed is True
        assert result.id == "no_approved_applications"

    def test_fails_when_some_apps_are_still_approved(self, monkeypatch):
        self._patch(monkeypatch, approved_count=2)
        result = NoApprovedApplicationsGuard().evaluate(self._market(), None)
        assert result.passed is False
        assert "still approved" in result.message.lower()

    def test_has_id_and_description(self):
        guard = NoApprovedApplicationsGuard()
        assert guard.id == "no_approved_applications"
        assert isinstance(guard.description, str)
        assert len(guard.description) > 0


class TestAssignmentEntryInvariants:
    """Every edge into assignment (currently only review -> assignment) must carry the
    reviewed-every-application guard, and the no-guaranteed-rejections one (E12/F03/S02)."""

    def test_review_to_assignment_is_guarded(self):
        guards = TRANSITION_GUARDS.get(("review", "assignment"), [])
        kinds = {type(guard) for guard in guards}
        assert AllApplicationsReviewedGuard in kinds
        assert NoAskedForTierWithoutTablesGuard in kinds
        assert NoOrphanedPinGuard in kinds


class TestOffersEntryInvariants:
    """Every edge into offers (currently only assignment -> offers) must carry the
    no-more-approved guard."""

    def test_assignment_to_offers_is_guarded(self):
        guards = TRANSITION_GUARDS.get(("assignment", "offers"), [])
        assert len(guards) == 1
        assert isinstance(guards[0], NoApprovedApplicationsGuard)


class TestNoAskedForTierWithoutTablesGuard:
    """A tier the plan gives no tables to, that an approved applicant is waiting on.

    This is the finding E12 answers, caught before the run rather than explained after it: two
    vendors unplaced beside nineteen free tables, because both had asked for a tier the market had
    no sections at. Without this the organizer presses Assign and learns it from the payoff screen.
    """

    def _market(self, tiers=("Gold", "Silver"), sections=(("Front", "Gold", 2),)):
        return _make_market(
            phase=MarketPhase.REVIEW,
            setup_object=SetupObject(
                priority=[],
                market_dates=[MarketDateObject(date="2026-08-01")],
                tiers=[TierObject(id=i, name=name) for i, name in enumerate(tiers)],
                locations=[],
                sections=[
                    SectionObject(name=name, tier=TierObject(id=0, name=tier), count=count)
                    for name, tier, count in sections
                ],
                assignment_options=AssignmentOptionObject(),
            ),
        )

    def _approved(self, monkeypatch, applications):
        monkeypatch.setattr(
            guards.ApplicationsApi, "list_applications_with_status",
            lambda _market_id, _status: applications,
        )

    def _application(self, email, tiers_by_date):
        return {
            "applicant_email": email,
            "form_data": {"essential_tier_preference": tiers_by_date},
        }

    def test_an_approved_applicant_waiting_on_an_empty_tier_blocks(self, monkeypatch):
        self._approved(monkeypatch, [
            self._application("nadia@ember.test", {"2026-08-01": ["Silver"]}),
        ])

        result = NoAskedForTierWithoutTablesGuard().evaluate(self._market(), None)

        assert result.passed is False

    def test_the_message_names_the_tier_and_the_applicants_not_a_count(self, monkeypatch):
        self._approved(monkeypatch, [
            self._application("nadia@ember.test", {"2026-08-01": ["Silver"]}),
            self._application("theo@thistle.test", {"2026-08-01": ["Silver"]}),
        ])

        message = NoAskedForTierWithoutTablesGuard().evaluate(self._market(), None).message

        assert "Silver" in message
        assert "nadia@ember.test" in message
        assert "theo@thistle.test" in message

    def test_an_empty_tier_nobody_asked_for_does_not_block(self, monkeypatch):
        """A tier the organizer declared and has not built out is harmless; the plan editor
        marks it, and that is the right weight for it."""
        self._approved(monkeypatch, [
            self._application("nadia@ember.test", {"2026-08-01": ["Gold"]}),
        ])

        result = NoAskedForTierWithoutTablesGuard().evaluate(self._market(), None)

        assert result.passed is True

    def test_adding_a_section_at_that_tier_clears_it(self, monkeypatch):
        self._approved(monkeypatch, [
            self._application("nadia@ember.test", {"2026-08-01": ["Silver"]}),
        ])
        market = self._market(sections=(("Front", "Gold", 2), ("Back", "Silver", 1)))

        assert NoAskedForTierWithoutTablesGuard().evaluate(market, None).passed is True

    def test_rejecting_those_applications_clears_it(self, monkeypatch):
        """Only approved applications are read, which is what the solver reads too."""
        self._approved(monkeypatch, [])

        result = NoAskedForTierWithoutTablesGuard().evaluate(self._market(), None)

        assert result.passed is True

    def test_a_section_with_no_tables_is_no_tables(self, monkeypatch):
        self._approved(monkeypatch, [
            self._application("nadia@ember.test", {"2026-08-01": ["Silver"]}),
        ])
        market = self._market(sections=(("Front", "Gold", 2), ("Back", "Silver", 0)))

        assert NoAskedForTierWithoutTablesGuard().evaluate(market, None).passed is False

    def test_a_tier_named_on_any_date_counts(self, monkeypatch):
        """The answer is stored per date, and a tier with no tables is a problem on every one."""
        self._approved(monkeypatch, [
            self._application(
                "nadia@ember.test", {"2026-08-01": ["Gold"], "2026-08-08": ["Silver"]},
            ),
        ])

        assert NoAskedForTierWithoutTablesGuard().evaluate(self._market(), None).passed is False

    def test_a_market_with_no_plan_does_not_block(self, monkeypatch):
        self._approved(monkeypatch, [])

        result = NoAskedForTierWithoutTablesGuard().evaluate(
            _make_market(phase=MarketPhase.REVIEW, setup_object=None), None,
        )

        assert result.passed is True


class TestNoOrphanedPinGuard:
    """A pin outlives the plan that held it, and the reckoning is deferred to here (E11/F02/S02).

    Deleting the section a pinned seat belongs to, or dropping the section's count below it,
    leaves the pin in place rather than deleting it. Silent deletion loses a deliberate
    guarantee; refusing the plan edit makes pins a lock on the floor plan.
    """

    def _market(self, placements=(), count=2):
        return _make_market(
            phase=MarketPhase.REVIEW,
            setup_object=SetupObject(
                priority=[],
                market_dates=[MarketDateObject(date="2026-08-01")],
                tiers=[TierObject(id=1, name="Gold")],
                locations=[],
                sections=[
                    SectionObject(name="Front", tier=TierObject(id=1, name="Gold"), count=count)
                ],
                assignment_options=AssignmentOptionObject(),
            ),
            assignment_object=AssignmentObject(vendor_assignments=list(placements)),
        )

    def _placement(self, table_code="Front 1", date="2026-08-01", hand_placed=True):
        return VendorAssignmentResult(
            email="nadia@ember.test",
            date=date,
            table_code=table_code,
            table_choice="Full Table",
            section="Front",
            tier="Gold",
            location="",
            hand_placed=hand_placed,
        )

    def test_a_market_with_no_pins_passes(self):
        assert NoOrphanedPinGuard().evaluate(self._market(), None).passed is True

    def test_a_pin_the_plan_still_holds_passes(self):
        market = self._market([self._placement("Front 2")])

        assert NoOrphanedPinGuard().evaluate(market, None).passed is True

    def test_dropping_the_table_count_below_a_pin_blocks(self):
        market = self._market([self._placement("Front 2")], count=1)

        result = NoOrphanedPinGuard().evaluate(market, None)

        assert result.passed is False
        assert result.id == "no_orphaned_pin"

    def test_the_message_names_the_vendor_and_the_seat(self):
        """Both ways out are things the organizer does to a named thing."""
        market = self._market([self._placement("Front 9")], count=1)

        message = NoOrphanedPinGuard().evaluate(market, None).message

        assert "nadia@ember.test" in message
        assert "Front 9" in message
        assert "2026-08-01" in message

    def test_a_solver_placement_at_a_vanished_seat_does_not_block(self):
        """Only a pin is a promise; stale solver output is recomputed by the next run."""
        market = self._market([self._placement("Front 9", hand_placed=False)], count=1)

        assert NoOrphanedPinGuard().evaluate(market, None).passed is True

    def test_re_placing_the_pin_clears_the_blocker(self):
        blocked = self._market([self._placement("Front 9")], count=1)
        assert NoOrphanedPinGuard().evaluate(blocked, None).passed is False

        re_placed = self._market([self._placement("Front 1")], count=1)
        assert NoOrphanedPinGuard().evaluate(re_placed, None).passed is True

    def test_removing_the_pin_clears_the_blocker(self):
        assert NoOrphanedPinGuard().evaluate(self._market([], count=1), None).passed is True

    def test_it_points_nowhere_because_its_two_remedies_are_in_two_places(self):
        """Restore the seat is the plan; move the vendor is the Tables view (E14/F01/S03).

        The Tables view is routed by market id, so no fixed string in this file could name it even
        if there were only one remedy. It used to say ``?tab=assignment``, which holds neither -
        that tab reports the assignment rather than editing it.
        """
        result = NoOrphanedPinGuard().evaluate(self._market([self._placement("Front 9")], count=1), None)

        assert result.passed is False
        assert result.resolution_link is None
        assert "Restore the seat" in result.message and "move those vendors" in result.message

    def test_a_market_with_no_plan_reports_its_pins_rather_than_passing(self):
        market = _make_market(
            phase=MarketPhase.REVIEW,
            assignment_object=AssignmentObject(vendor_assignments=[self._placement()]),
        )

        assert NoOrphanedPinGuard().evaluate(market, None).passed is False


class TestEveryResolutionLinkPointsAtItsFix:
    """A blocker's "Fix this" must go somewhere, and somewhere specific (E14/F01/S03).

    The rail carries ``BlockerPanel`` onto four organizer screens, so a bare ``/market-setup`` is
    usually the page the blocker is already displayed on: the link rendered as a control and did
    nothing when clicked. Every link that exists must therefore name the TAB holding the remedy.

    Read out of the source with ``ast`` rather than by evaluating each guard, so the rule covers
    the next guard someone writes without that guard needing a test of its own - which is how the
    original ``/market-setup`` spread to four call sites. It is a test rather than a check in
    ``PreconditionResult.__post_init__`` because a guard builds its result while answering a
    transition request: a raise there would turn a mistyped link into a 500 for the organizer,
    where this turns it into a red build for whoever typed it.
    """

    #: Routes a link may name, relative to the market's own screens: its pages, each of which has
    #: its own address since E22/F04/S02, so a link to one is never the page it is read from unless
    #: it truly is that page.
    ALLOWED = {
        "setup",
        "form",
        "applications",
        "assignment",
        "result",
        "vendors",
        "attendance",
    }
    #: A redirect (the panel cannot follow a hop - the ``?tab=`` pages and ``tables`` are the old
    #: addresses), or an absolute path (a link is relative to the market's own screens; the id-less
    #: paths redirect).
    REFUSED = {
        "setup?tab=applications",
        "setup?tab=assignment",
        "setup?tab=setup",
        "tables",
        "/market-setup",
        "/market-setup?tab=applications",
        "/market-setup?tab=assignment",
        "/assignment-results",
    }

    def _link_nodes(self):
        """Every ``resolution_link`` argument in the module, keyword or positional."""
        source = pathlib.Path(guards.__file__).read_text()
        found = []
        for node in ast.walk(ast.parse(source)):
            if not isinstance(node, ast.Call):
                continue
            called = node.func.id if isinstance(node.func, ast.Name) else None
            for kw in node.keywords:
                if kw.arg == "resolution_link":
                    found.append(kw.value)
            # ``resolution_link`` is the fourth field, so a positional call reaches it at index 3.
            # None exists today; catching it keeps the scan from quietly skipping the first one.
            if called == "PreconditionResult" and len(node.args) >= 4:
                found.append(node.args[3])
        return found

    def _links(self):
        return [n.value for n in self._link_nodes() if isinstance(n, ast.Constant)]

    def test_the_guards_declare_some_links(self):
        """Guards against the scan silently finding nothing and passing everything below."""
        assert len([link for link in self._links() if link is not None]) >= 2

    def test_every_link_is_a_literal_this_test_can_read(self):
        """A computed link would slip past the scan, so it is refused rather than skipped."""
        unreadable = [ast.dump(n) for n in self._link_nodes() if not isinstance(n, ast.Constant)]
        assert unreadable == [], (
            "resolution_link must be a literal so this rule can check it; "
            f"found {unreadable}"
        )

    def test_no_link_names_a_bare_page_or_a_redirect(self):
        offenders = [link for link in self._links() if link in self.REFUSED]
        assert offenders == [], (
            f"resolution_link must name the tab holding the fix, not {sorted(set(offenders))}. "
            "A bare page is the one the blocker is usually displayed on, a redirect cannot be "
            "resolved by the panel's own-page check, and ?tab=setup is indistinguishable from a "
            "bare /market-setup."
        )

    def test_every_link_names_a_known_destination(self):
        unknown = [
            link
            for link in self._links()
            if link is not None and link not in self.ALLOWED
        ]
        assert unknown == [], f"unrecognized resolution_link: {sorted(set(unknown))}"
