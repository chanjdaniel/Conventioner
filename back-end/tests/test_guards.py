"""Unit tests for the guard registry and phase transition evaluation (PR 2)."""
import ast
import os
import pathlib
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from conftest import complete_setup, review_setup_decided

import guards
from datatypes import (
    ApplicationForm, AssignmentOptionObject, AssignmentObject, EssentialFormOptions, FormField,
    IntakeMode, Market, MarketDateObject, MarketPhase, MarketRole, PhaseEntry, RejectionRule,
    SectionObject,
    SetupObject, TierObject, VendorAssignmentResult,
)
from guards import (
    AllApplicationsReviewedGuard,
    AssignmentNotBeforeReviewGuard,
    NoAskedForTierWithoutTablesGuard,
    NoOrphanedPinGuard,
    FormHasFieldsGuard,
    NoApprovedApplicationsGuard,
    PHASE_ENTRY_INVARIANTS,
    PreconditionResult,
    RejectionRulesDecidedGuard,
    ResponsesImportedGuard,
    ResultsNotPublishedGuard,
    ReviewHighlightsDecidedGuard,
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
            resolution_label="Fix it",
            resolution_action="change-setup",
        )
        assert r.passed is False
        assert r.message == "Something is wrong."
        assert r.resolution_link == "/fix-it"
        assert r.resolution_label == "Fix it"
        assert r.resolution_action == "change-setup"

    def test_a_link_carries_the_words_for_it(self):
        """The rail draws the fix as its main button (E32/F01/S02), so a link needs a name."""
        with pytest.raises(ValueError, match="resolution_label"):
            PreconditionResult(
                id="test", passed=False, message="No.", resolution_link="setup",
                resolution_action="change-setup",
            )

    def test_words_without_a_link_lead_nowhere(self):
        with pytest.raises(ValueError, match="resolution_link"):
            PreconditionResult(id="test", passed=False, message="No.", resolution_label="Fix it")

    def test_a_link_names_the_action_it_takes(self):
        """The rail offers a remedy only to someone the table lets take it (T142), so a link says
        which row of the table that is."""
        with pytest.raises(ValueError, match="resolution_action"):
            PreconditionResult(
                id="test", passed=False, message="No.", resolution_link="setup",
                resolution_label="Fix it",
            )

    def test_an_action_without_a_link_leads_nowhere(self):
        with pytest.raises(ValueError, match="resolution_link"):
            PreconditionResult(
                id="test", passed=False, message="No.", resolution_action="change-setup",
            )

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


class TestReviewHighlightsDecidedGuard:
    """A draft enters Review only once its organizer has decided what a reviewer reads first (T206).

    Decided is a mark on an answer the market asks, or "Nothing leads the card" chosen. An empty
    list is nobody having asked, and a mark on a question the form no longer asks leads the card
    with nothing.
    """

    @staticmethod
    def _market(highlights=None, nothing_leads=False, fields=("stall",), dates=()):
        return _make_market(
            phase=MarketPhase.DRAFT,
            setup_object=_setup(dates=dates),
            application_form=ApplicationForm(
                fields=[FormField(key=key, label=key.title(), type="text") for key in fields],
            ),
            review_highlights=highlights,
            nothing_leads_the_card=nothing_leads,
        )

    def _verdict(self, **kwargs):
        return ReviewHighlightsDecidedGuard().evaluate(self._market(**kwargs), None)

    def test_refuses_a_draft_with_nothing_marked_and_nothing_chosen(self):
        result = self._verdict(highlights=None)
        assert result.passed is False
        assert result.id == "review_highlights_decided"

    def test_an_empty_list_is_not_a_decision(self):
        assert self._verdict(highlights=[]).passed is False

    def test_nothing_leads_the_card_decides_it(self):
        assert self._verdict(highlights=[], nothing_leads=True).passed is True

    def test_a_mark_on_one_of_the_forms_questions_decides_it(self):
        assert self._verdict(highlights=["stall"]).passed is True

    def test_a_mark_on_an_asked_essential_question_decides_it(self):
        result = self._verdict(highlights=["essential_available_dates"], dates=["2026-05-01"])
        assert result.passed is True

    def test_a_mark_on_an_essential_question_the_plan_does_not_ask_is_no_decision(self):
        """No dates, so nobody is asked which dates they can do."""
        assert self._verdict(highlights=["essential_available_dates"]).passed is False

    def test_marks_on_questions_the_form_no_longer_asks_are_no_decision(self):
        assert self._verdict(highlights=["removed", "gone_too"]).passed is False

    def test_one_live_mark_among_stale_ones_decides_it(self):
        assert self._verdict(highlights=["removed", "stall"]).passed is True

    def test_it_leads_to_review_setup_with_the_forms_action(self):
        result = self._verdict(highlights=None)
        assert result.resolution_link == "form?step=review"
        assert result.resolution_label == "Decide what reviewers read first"
        assert result.resolution_action == "change-form"
        assert "Nothing leads the card" in result.message

    def test_it_sits_on_leaving_draft_after_the_form_and_before_the_import(self):
        ids = [guard.id for guard in TRANSITION_GUARDS[("draft", "applications")]]
        assert ids.index("form_has_fields") < ids.index("review_highlights_decided")
        assert ids.index("review_highlights_decided") < ids.index("responses_imported")

    def test_it_is_no_entry_invariant_so_no_other_way_into_review_meets_it(self):
        """T207 adds a way back into Review from Assignment, for markets that left draft before
        this guard existed."""
        assert "review_highlights_decided" not in {
            guard.id for invariants in PHASE_ENTRY_INVARIANTS.values() for guard in invariants
        }

    def test_it_guards_no_move_but_leaving_draft(self):
        guarded = {
            edge for edge, edge_guards in TRANSITION_GUARDS.items()
            if any(guard.id == "review_highlights_decided" for guard in edge_guards)
        }
        assert guarded == {("draft", "applications")}

    @pytest.mark.parametrize("phase", [
        MarketPhase.APPLICATIONS, MarketPhase.ASSIGNMENT, MarketPhase.OFFERS,
        MarketPhase.MARKET_DAYS, MarketPhase.ARCHIVED,
    ])
    def test_a_market_past_draft_with_nothing_decided_is_refused_nothing_for_it(
            self, phase, monkeypatch):
        monkeypatch.setattr(guards.ApplicationsApi, "count_applications_for_market", lambda _id: 0)
        monkeypatch.setattr(
            guards.ApplicationsApi, "count_applications_with_any_status", lambda _id, _s: 0)
        market = self._market(highlights=None).model_copy(update={"phase": phase})

        refused = {
            blocker.id
            for blockers in guards.transition_verdicts(market, None).values()
            for blocker in blockers
        }
        assert "review_highlights_decided" not in refused


class TestRejectionRulesDecidedGuard:
    """A draft enters Review only once its organizer has decided the automatic rejections (T206).

    Decided is a rule that names an answer, as the rules stand against the current form, or "No
    automatic rejections" chosen. No rules is nobody having asked, a rule with no answer ticked
    rejects nothing, and a rule on a question the form no longer asks judges nothing.
    """

    @staticmethod
    def _market(rules=None, no_rejections=False, fields=("stall",)):
        return _make_market(
            phase=MarketPhase.DRAFT,
            setup_object=_setup(),
            application_form=ApplicationForm(fields=[
                FormField(key=key, label=key.title(), type="select", options=["Yes", "No"])
                for key in fields
            ]),
            rejection_rules=[RejectionRule(**rule) for rule in rules] if rules is not None else None,
            no_automatic_rejections=no_rejections,
        )

    def _verdict(self, **kwargs):
        return RejectionRulesDecidedGuard().evaluate(self._market(**kwargs), None)

    def test_refuses_a_draft_with_no_rules_and_nothing_chosen(self):
        result = self._verdict(rules=None)
        assert result.passed is False
        assert result.id == "rejection_rules_decided"

    def test_an_empty_list_is_not_a_decision(self):
        assert self._verdict(rules=[]).passed is False

    def test_no_automatic_rejections_decides_it(self):
        assert self._verdict(rules=[], no_rejections=True).passed is True

    def test_a_rule_that_names_an_answer_decides_it(self):
        assert self._verdict(rules=[{"key": "stall", "answers": ["No"]}]).passed is True

    def test_a_rule_with_no_answer_ticked_is_no_decision(self):
        """The organizer picked the question and stopped: it rejects nothing."""
        assert self._verdict(rules=[{"key": "stall", "answers": []}]).passed is False

    def test_a_rule_on_a_question_the_form_no_longer_asks_is_no_decision(self):
        assert self._verdict(rules=[{"key": "removed", "answers": ["No"]}]).passed is False

    def test_a_rule_naming_only_answers_the_question_no_longer_offers_is_no_decision(self):
        assert self._verdict(rules=[{"key": "stall", "answers": ["Maybe"]}]).passed is False

    def test_one_answered_rule_among_empty_ones_decides_it(self):
        result = self._verdict(
            rules=[{"key": "stall", "answers": []}, {"key": "tent", "answers": ["Yes"]}],
            fields=("stall", "tent"),
        )
        assert result.passed is True

    def test_it_leads_to_review_setup_with_the_forms_action(self):
        result = self._verdict(rules=None)
        assert result.resolution_link == "form?step=review"
        assert result.resolution_label == "Decide the automatic rejections"
        assert result.resolution_action == "change-form"
        assert "No automatic rejections" in result.message

    def test_the_edge_offers_the_setup_the_form_review_setup_then_the_import(self):
        ids = [guard.id for guard in TRANSITION_GUARDS[("draft", "applications")]]
        assert ids == [
            "setup_has_dates", "setup_has_a_location", "every_tier_has_tables",
            "price_groups_stand", "form_has_fields", "review_highlights_decided",
            "rejection_rules_decided", "responses_imported",
        ]

    def test_it_is_no_entry_invariant_so_no_other_way_into_review_meets_it(self):
        assert "rejection_rules_decided" not in {
            guard.id for invariants in PHASE_ENTRY_INVARIANTS.values() for guard in invariants
        }

    def test_it_guards_no_move_but_leaving_draft(self):
        guarded = {
            edge for edge, edge_guards in TRANSITION_GUARDS.items()
            if any(guard.id == "rejection_rules_decided" for guard in edge_guards)
        }
        assert guarded == {("draft", "applications")}

    @pytest.mark.parametrize("phase", [
        MarketPhase.APPLICATIONS, MarketPhase.ASSIGNMENT, MarketPhase.OFFERS,
        MarketPhase.MARKET_DAYS, MarketPhase.ARCHIVED,
    ])
    def test_a_market_past_draft_with_nothing_decided_is_refused_nothing_for_it(
            self, phase, monkeypatch):
        monkeypatch.setattr(guards.ApplicationsApi, "count_applications_for_market", lambda _id: 0)
        monkeypatch.setattr(
            guards.ApplicationsApi, "count_applications_with_any_status", lambda _id, _s: 0)
        market = self._market(rules=None).model_copy(update={"phase": phase})

        refused = {
            blocker.id
            for blockers in guards.transition_verdicts(market, None).values()
            for blocker in blockers
        }
        assert "rejection_rules_decided" not in refused


class TestEvaluateTransition:
    def test_returns_blockers_when_guard_fails(self):
        # No plan and no form: the form asks nothing, and the setup is incomplete (E31/F01/S01).
        market = _make_market(phase=MarketPhase.DRAFT, application_form=None)
        blockers = evaluate_transition(market, "applications", None)
        assert "form_has_fields" in [b.id for b in blockers]
        assert all(b.passed is False for b in blockers)

    def test_returns_empty_when_guard_passes(self):
        market = _make_market(
            phase=MarketPhase.DRAFT,
            intake_mode=IntakeMode.FORM,
            setup_object=complete_setup(),
            application_form=ApplicationForm(
                fields=[FormField(key="name", label="Name", type="text")],
            ),
            **review_setup_decided(),
        )
        blockers = evaluate_transition(market, "applications", None)
        assert blockers == []

    def test_returns_empty_for_unguarded_transition(self):
        market = _make_market(phase=MarketPhase.APPLICATIONS)
        blockers = evaluate_transition(market, "archived", None)
        assert blockers == []

    def test_a_guard_the_caller_satisfies_itself_is_left_out(self):
        """A Google Form market's first import judges the move before writing what it waits on."""
        market = _make_market(
            phase=MarketPhase.DRAFT,
            setup_object=complete_setup(),
            application_form=ApplicationForm(
                fields=[FormField(key="name", label="Name", type="text")],
            ),
            **review_setup_decided(),
        )

        assert [b.id for b in evaluate_transition(market, "applications", None)] == [
            "responses_imported",
        ]
        assert evaluate_transition(
            market, "applications", None, leaving_out=("responses_imported",),
        ) == []

    def test_returns_empty_for_nonexistent_transition(self):
        market = _make_market(phase=MarketPhase.DRAFT)
        blockers = evaluate_transition(market, "archived", None)
        assert blockers == []


class TestValidTransitions:
    def test_the_stage_is_entered_from_draft_and_left_for_assignment(self):
        """One stage where applications arrive and are reviewed (E38/F04/S01)."""
        assert ("draft", "applications") in VALID_TRANSITIONS
        assert ("applications", "draft") in VALID_TRANSITIONS
        assert ("applications", "assignment") in VALID_TRANSITIONS
        assert {to for frm, to in VALID_TRANSITIONS if frm == "applications"} == {
            "draft", "assignment", "archived",
        }

    def test_later_phase_transitions_are_registered(self):
        assert ("assignment", "offers") in VALID_TRANSITIONS
        assert ("offers", "market_days") in VALID_TRANSITIONS
        assert ("market_days", "archived") in VALID_TRANSITIONS

    def test_only_the_stage_may_return_to_draft(self):
        """The reverse edge exists now (E03/F04), and only from the phase right after draft.

        This used to assert no edge returned to draft at all. That made the application form
        unfixable: it is editable only in draft, importing is permitted only once applications are
        open, so every custom field had to be anticipated before the organizer had seen their own
        columns. The edge is guarded on no application existing, which is what keeps D9 intact -
        see tests/test_returning_to_draft.py.
        """
        into_draft = {frm for frm, to in VALID_TRANSITIONS if to == "draft"}

        assert into_draft == {"applications"}

    def test_the_stage_is_entered_from_draft_and_back_from_assignment(self):
        """Back to review (T207): the one way back past the stage, and none from later on."""
        into_the_stage = {frm for frm, to in VALID_TRANSITIONS if to == "applications"}

        assert into_the_stage == {"draft", "assignment"}

    def test_archive_from_every_phase_is_registered(self):
        phases = [p.value for p in MarketPhase if p != MarketPhase.ARCHIVED]
        for phase in phases:
            assert (phase, "archived") in VALID_TRANSITIONS, (
                f"Missing archive edge from {phase}"
            )


class TestTransitionGuards:
    def test_draft_to_the_stage_has_form_guard(self):
        guards = TRANSITION_GUARDS.get(("draft", "applications"), [])
        assert any(isinstance(guard, FormHasFieldsGuard) for guard in guards)

    def test_draft_to_the_stage_waits_on_a_google_form_markets_import(self):
        guards = TRANSITION_GUARDS.get(("draft", "applications"), [])
        assert any(isinstance(guard, ResponsesImportedGuard) for guard in guards)

    def test_unguarded_transitions_not_in_registry(self):
        assert ("applications", "archived") not in TRANSITION_GUARDS

    def test_every_edge_into_the_stage_is_guarded(self):
        """The form invariant belongs to the target phase, so no edge may skip it."""
        inbound = [t for t in VALID_TRANSITIONS if t[1] == "applications"]
        assert inbound
        for transition in inbound:
            guard_ids = {g.id for g in TRANSITION_GUARDS.get(transition, [])}
            assert {"form_has_fields", "responses_imported"} <= guard_ids, (
                f"{transition} enters applications without its entry invariants"
            )


class TestRegistrySelfCheck:
    """The registry has to catch every way a one-file edit can silently drop a guard."""

    BOTH_INBOUND_EDGES = {
        ("draft", "applications"),
        ("assignment", "applications"),
    }

    def _validate(self, monkeypatch, valid_transitions, transition_guards, entry_invariants=None):
        monkeypatch.setattr(guards, "VALID_TRANSITIONS", valid_transitions)
        monkeypatch.setattr(guards, "TRANSITION_GUARDS", transition_guards)
        monkeypatch.setattr(
            guards,
            "PHASE_ENTRY_INVARIANTS",
            {"applications": [FormHasFieldsGuard()]} if entry_invariants is None
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
                {("draft", "applications")},
                {("draft", "application_open"): [FormHasFieldsGuard()]},
            )

    def test_inbound_edge_missing_an_entry_invariant_is_rejected(self, monkeypatch):
        """This is the reopen-edge hole: one route into a phase skipping its precondition."""
        with pytest.raises(RuntimeError, match="does not enforce the entry invariants"):
            self._validate(
                monkeypatch,
                self.BOTH_INBOUND_EDGES,
                {("draft", "applications"): [FormHasFieldsGuard()]},
            )

    def test_every_inbound_edge_carrying_the_invariant_is_accepted(self, monkeypatch):
        self._validate(
            monkeypatch,
            self.BOTH_INBOUND_EDGES,
            {
                ("draft", "applications"): [FormHasFieldsGuard()],
                ("assignment", "applications"): [FormHasFieldsGuard()],
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
                    ("draft", "applications"): [],
                    ("assignment", "applications"): [],
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

        A rule about one route into a phase is meaningless on another, so the check must not
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
                ("draft", "applications"): [FormHasFieldsGuard()],
                ("assignment", "applications"): [
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
        # The four parts of a complete setup (E31/F01/S01, E43/F01/S02), the form, what a reviewer
        # reads first and the automatic rejections (T206), and a Google Form market's import
        # (E38/F04/S01): eight list entries.
        guards = TRANSITION_GUARDS[("draft", "applications")]
        assert len(guards) == 8


class TestAllApplicationsReviewedGuard:
    def _market(self):
        return _make_market(
            phase=MarketPhase.APPLICATIONS,
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
    """Every edge into assignment (currently only applications -> assignment) must carry the
    reviewed-every-application guard, and the no-guaranteed-rejections one (E12/F03/S02)."""

    def test_the_stage_to_assignment_is_guarded(self):
        guards = TRANSITION_GUARDS.get(("applications", "assignment"), [])
        kinds = {type(guard) for guard in guards}
        assert AllApplicationsReviewedGuard in kinds
        assert NoAskedForTierWithoutTablesGuard in kinds
        assert NoOrphanedPinGuard in kinds


class TestBackToReview:
    """``assignment -> applications`` (T207): the review reopens until results are published."""

    MESSAGE = (
        "Results are published: applicants have read whether they have a table, so the review "
        "cannot reopen. To change who has a table, place or free a seat on Assignments."
    )

    def test_the_edge_carries_the_stages_invariants_and_the_results_guard(self):
        guard_ids = [g.id for g in TRANSITION_GUARDS[("assignment", "applications")]]

        assert set(guard_ids) == {"form_has_fields", "responses_imported", "results_not_published"}

    def test_only_the_way_back_asks_it(self):
        carrying = {edge for edge, guards in TRANSITION_GUARDS.items()
                    if any(isinstance(g, ResultsNotPublishedGuard) for g in guards)}

        assert carrying == {("assignment", "applications")}

    def test_a_market_whose_results_are_published_is_refused_in_words(self):
        result = ResultsNotPublishedGuard().evaluate(
            _make_market(intake_mode=IntakeMode.FORM, results_published=True), None)

        assert not result.passed
        assert result.id == "results_not_published"
        assert result.message == self.MESSAGE
        # No page reopens the review, so the refusal names none.
        assert (result.resolution_link, result.resolution_label, result.resolution_action) == (
            None, None, None)

    def test_a_form_market_not_yet_published_may_go_back(self):
        result = ResultsNotPublishedGuard().evaluate(
            _make_market(intake_mode=IntakeMode.FORM, results_published=False), None)

        assert result.passed

    def test_a_google_form_market_not_yet_published_may_go_back(self):
        result = ResultsNotPublishedGuard().evaluate(
            _make_market(intake_mode=IntakeMode.CSV, results_published=False), None)

        assert result.passed

    def test_a_google_form_market_published_is_refused_too(self):
        """Its vendors have read their results on its vendor page (ADR 0022)."""
        result = ResultsNotPublishedGuard().evaluate(
            _make_market(intake_mode=IntakeMode.CSV, results_published=True), None)

        assert not result.passed
        assert result.id == "results_not_published"

    def test_it_has_id_and_description(self):
        guard = ResultsNotPublishedGuard()

        assert guard.id == "results_not_published"
        assert guard.description


class TestAssignmentNotBeforeReviewGuard:
    """A market does not go live on a run made before its review reopened (T207, ADR 0021).

    Publish results already waits on any out-of-date run; a Google Form market has no Publish
    results, so without this a vendor rejected in the reopened review could keep the run's seat.
    """

    MESSAGE = (
        "The review was reopened after tables were allocated. Allocate tables again before the "
        "market goes live."
    )
    ONCE = ("draft", "applications", "assignment")
    AGAIN = ONCE + ("applications", "assignment")

    def _market(self, history, recorded="1", intake=IntakeMode.CSV):
        made_from = {"rules": "r", "plan": "p", "applications": "a"}
        if recorded is not None:
            made_from["review"] = recorded
        return _make_market(
            phase=MarketPhase.ASSIGNMENT,
            intake_mode=intake,
            phase_history=[PhaseEntry(phase=phase, entered_at="2026-01-01") for phase in history],
            assignment_object=AssignmentObject(
                vendor_assignments=[VendorAssignmentResult(
                    email="ana@example.com", date="2026-08-01", table_code="A 1",
                    table_choice="Full Table", section="A", tier="Gold", location="Hall",
                )],
                made_from=made_from,
            ),
        )

    def test_a_run_made_before_the_review_reopened_is_refused_in_words(self):
        result = AssignmentNotBeforeReviewGuard().evaluate(self._market(self.AGAIN), None)

        assert not result.passed
        assert result.id == "assignment_after_review"
        assert result.message == self.MESSAGE
        assert (result.resolution_link, result.resolution_label, result.resolution_action) == (
            "settings", "Allocate tables", "assign")

    def test_a_run_made_after_it_passes(self):
        result = AssignmentNotBeforeReviewGuard().evaluate(
            self._market(self.AGAIN, recorded="2"), None)

        assert result.passed

    def test_a_market_that_never_went_back_passes(self):
        assert AssignmentNotBeforeReviewGuard().evaluate(self._market(self.ONCE), None).passed

    def test_a_run_recorded_without_the_group_passes(self):
        """Not known to be out of date by it, as the read says."""
        result = AssignmentNotBeforeReviewGuard().evaluate(
            self._market(self.AGAIN, recorded=None), None)

        assert result.passed

    def test_it_reads_no_application(self, monkeypatch):
        """Only the review group: a plan or rule edit after publishing never refuses going live."""
        import assignment.made_from as MadeFrom

        def refuse(*_args):
            raise AssertionError("read the approved applications")

        monkeypatch.setattr(MadeFrom, "approved_solver_vendors", refuse)

        assert not AssignmentNotBeforeReviewGuard().evaluate(self._market(self.AGAIN), None).passed

    def test_every_way_into_market_days_carries_it_ahead_of_the_results(self):
        assert "assignment_after_review" in {
            g.id for g in guards.PHASE_ENTRY_INVARIANTS["market_days"]}
        for edge in (("assignment", "market_days"), ("offers", "market_days")):
            ids = [g.id for g in TRANSITION_GUARDS[edge]]
            assert ids.index("assignment_after_review") < ids.index("results_published"), edge

    def test_no_other_edge_asks_it(self):
        carrying = {edge for edge, guards_on in TRANSITION_GUARDS.items()
                    if any(isinstance(g, AssignmentNotBeforeReviewGuard) for g in guards_on)}

        assert carrying == {("assignment", "market_days"), ("offers", "market_days")}


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
            phase=MarketPhase.APPLICATIONS,
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
            _make_market(phase=MarketPhase.APPLICATIONS, setup_object=None), None,
        )

        assert result.passed is True


class TestNoOrphanedPinGuard:
    """A pin outlives the plan that held it, and the reckoning is deferred to here (E11/F02/S02).

    Deleting the section a pinned seat belongs to, or dropping the section's count below it,
    leaves the pin in place rather than deleting it. Silent deletion loses a deliberate
    guarantee; refusing the plan edit makes pins a lock on the floor plan.
    """

    def test_it_guards_publishing_too(self):
        """A market already in assignment need not re-enter it before it goes live, so a seat
        dropped from the plan after the run met no guard and was published with a vendor sent to
        it (bug 31)."""
        for edge in (("assignment", "market_days"), ("offers", "market_days")):
            assert "no_orphaned_pin" in {g.id for g in guards.TRANSITION_GUARDS[edge]}, edge
        assert "no_orphaned_pin" in {g.id for g in guards.PHASE_ENTRY_INVARIANTS["market_days"]}

    def _market(self, placements=(), count=2):
        return _make_market(
            phase=MarketPhase.APPLICATIONS,
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
        assert "Restore the seat" in result.message and "move or free those vendors" in result.message

    def test_a_market_with_no_plan_reports_its_pins_rather_than_passing(self):
        market = _make_market(
            phase=MarketPhase.APPLICATIONS,
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
        # The Application Form tab's Review setup step, which has its own address (T206).
        "form?step=review",
        "applications",
        # The Assignment tab's Settings and Assignments, named Assignment and Result until
        # E38/F08/S01; the old names redirect, so a link naming one is refused below.
        "settings",
        "assignments",
        "vendors",
        "attendance",
        # The import flow, which has its own address (E32/F02/S01: the fix for an empty review).
        "import",
    }
    #: A redirect (the panel cannot follow a hop - the ``?tab=`` pages and ``tables`` are the old
    #: addresses), or an absolute path (a link is relative to the market's own screens; the id-less
    #: paths redirect).
    REFUSED = {
        "setup?tab=applications",
        "setup?tab=assignment",
        "setup?tab=setup",
        "tables",
        "assignment",
        "result",
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



class TestEveryRemedyNamesTheActionItTakes:
    """A remedy is offered only to someone who may take it (T142): the rail asks the table's answer
    for the row the remedy takes, so every guard that leads somewhere names that row.

    Read out of the source as the links are, and for the same reason: a row the table no longer
    holds would hide the remedy from everyone, and a raise at construction would turn that into a
    500 for the organizer rather than a red build.
    """

    #: What each remedy does, by the words it is offered under: the spec's table.
    ACTION_OF = {
        "Pick market dates": "change-setup",
        "Change the dates": "change-setup",
        "Add a location": "change-setup",
        "Add tables": "change-setup",
        "Give every tier tables": "change-setup",
        "Fix the price groups": "change-setup",
        "Allocate tables": "assign",
        "Publish results": "publish-results",
        "Finish deciding": "give-verdicts",
        "Import responses": "import-applications",
        "Decide what reviewers read first": "change-form",
        "Decide the automatic rejections": "change-form",
    }

    def _remedies(self):
        """Every ``PreconditionResult(...)`` in the module that leads somewhere, as its keywords."""
        source = pathlib.Path(guards.__file__).read_text()
        found = []
        for node in ast.walk(ast.parse(source)):
            if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                    and node.func.id == "PreconditionResult"):
                continue
            keywords = {kw.arg: kw.value for kw in node.keywords}
            link = keywords.get("resolution_link")
            if link is None or (isinstance(link, ast.Constant) and link.value is None):
                continue
            found.append(keywords)
        return found

    def test_the_scan_finds_every_remedy(self):
        """Guards against the scan silently finding nothing and passing everything below."""
        assert len(self._remedies()) >= len(self.ACTION_OF)

    def test_every_remedy_names_a_row_of_the_table(self):
        from api.market_actions import ACTIONS

        unnamed = []
        for keywords in self._remedies():
            action = keywords.get("resolution_action")
            if not (isinstance(action, ast.Constant) and action.value in ACTIONS):
                unnamed.append(ast.dump(action) if action is not None else None)
        assert unnamed == [], (
            "every resolution_link names, as a literal, the row of api/market_actions.py's table "
            f"that its remedy takes; found {unnamed}"
        )

    def test_each_remedy_takes_the_action_it_does(self):
        named = {}
        for keywords in self._remedies():
            label, action = keywords["resolution_label"], keywords.get("resolution_action")
            named.setdefault(label.value, set()).add(getattr(action, "value", None))
        assert named == {label: {action} for label, action in self.ACTION_OF.items()}


def test_no_guard_reads_the_phase():
    """A move is judged against the market as it stands, and a Google Form market's first import
    judges the move into Review before it writes (``first_import_blockers``). That is sound only
    while no guard's verdict depends on the phase it is asked on, so a guard that reads it is
    refused here."""
    source = pathlib.Path(guards.__file__).read_text()
    readers = []
    for cls in ast.walk(ast.parse(source)):
        if not (isinstance(cls, ast.ClassDef) and cls.name.endswith("Guard")):
            continue
        for node in ast.walk(cls):
            if isinstance(node, ast.Attribute) and node.attr == "phase":
                readers.append(cls.name)
    assert readers == []
