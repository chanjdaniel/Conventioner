"""Unit tests for the guard registry and phase transition evaluation (PR 2)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

import guards
from datatypes import (
    ApplicationForm, AssignmentObject, FormField, Market, MarketPhase, MarketRole,
)
from guards import (
    FormHasFieldsGuard,
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
    def test_passes_when_form_has_fields(self):
        market = _make_market(
            application_form=ApplicationForm(
                fields=[FormField(key="name", label="Name", type="text")],
            ),
        )
        result = FormHasFieldsGuard().evaluate(market, None)
        assert result.passed is True
        assert result.id == "form_has_fields"

    def test_fails_when_form_is_none(self):
        market = _make_market(application_form=None)
        result = FormHasFieldsGuard().evaluate(market, None)
        assert result.passed is False
        assert "no fields" in result.message.lower()
        assert result.resolution_link is not None

    def test_fails_when_form_has_empty_fields_list(self):
        market = _make_market(
            application_form=ApplicationForm(fields=[]),
        )
        result = FormHasFieldsGuard().evaluate(market, None)
        assert result.passed is False
        assert "no fields" in result.message.lower()


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

    def test_later_phase_transitions_not_registered(self):
        assert ("applications_closed", "review") not in VALID_TRANSITIONS
        assert ("review", "assignment") not in VALID_TRANSITIONS
        assert ("assignment", "offers") not in VALID_TRANSITIONS
        assert ("offers", "market_days") not in VALID_TRANSITIONS
        assert ("market_days", "archived") not in VALID_TRANSITIONS

    def test_reverse_draft_not_registered(self):
        assert ("applications_open", "draft") not in VALID_TRANSITIONS


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
