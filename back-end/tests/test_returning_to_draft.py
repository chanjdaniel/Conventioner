"""A market can go back to draft while nobody has applied, so its form can be corrected.

E03/F04, decided by wayfinder ticket 05.

The trap this opens: the application form is editable only in ``draft``, importing is permitted only
in ``applications_open``, and no transition returned to ``draft``. So an organizer had to name every
custom field they would ever want *before* they had seen the import screen or their own columns, and
one click froze the form for good - which is why a reviewer is shown an email address and nothing
else.

The guard is what makes this safe rather than a hole in D9. Applicant submission is gated to
``applications_open`` (``api/applicants.py``), so a count of zero is only *stable* in ``draft``;
while applications are open it is a read-then-write race. Returning is therefore permitted only
while no application exists, and once one does the form is frozen for good exactly as before.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import api.applications as ApplicationsApi  # noqa: E402
import guards  # noqa: E402
from datatypes import Market, MarketPhase, MarketRole  # noqa: E402
from guards import NoApplicationsYetGuard, VALID_TRANSITIONS, evaluate_transition  # noqa: E402


def _market(phase=MarketPhase.APPLICATIONS_OPEN):
    return Market(
        id="market-1",
        name="Test Market",
        creation_date="2026-01-01",
        roles={"user-1": MarketRole.OWNER},
        modification_list=[],
        assignment_object={},
        phase=phase,
    )


@pytest.fixture
def application_count(monkeypatch):
    def _set(n):
        monkeypatch.setattr(
            ApplicationsApi, "count_applications_for_market", lambda market_id: n,
        )
    return _set


class TestTheEdgeExists:
    def test_applications_open_can_return_to_draft(self):
        assert ("applications_open", "draft") in VALID_TRANSITIONS

    def test_no_other_phase_may_return_to_draft(self):
        """Only the phase immediately after draft, and only while nothing has been submitted.

        A market that has closed applications, begun review, or assigned has moved past the point
        where its form is a draft of anything.
        """
        into_draft = {frm for frm, to in VALID_TRANSITIONS if to == "draft"}

        assert into_draft == {"applications_open"}


class TestTheGuard:
    def test_it_passes_while_nobody_has_applied(self, application_count):
        application_count(0)

        result = NoApplicationsYetGuard().evaluate(_market(), None)

        assert result.passed

    def test_it_blocks_once_one_application_exists(self, application_count):
        application_count(1)

        result = NoApplicationsYetGuard().evaluate(_market(), None)

        assert not result.passed

    def test_the_refusal_says_how_many_and_reads_as_one_application(self, application_count):
        application_count(1)

        message = NoApplicationsYetGuard().evaluate(_market(), None).message

        assert "1 application has" in message

    def test_the_refusal_pluralises(self, application_count):
        application_count(232)

        message = NoApplicationsYetGuard().evaluate(_market(), None).message

        assert "232 applications have" in message


class TestTheEdgeIsGuarded:
    """The endpoint is reachable directly, so the rule must live in the registry, not the UI."""

    def test_the_transition_is_refused_when_an_application_exists(self, application_count):
        application_count(1)

        blockers = evaluate_transition(_market(), MarketPhase.DRAFT, None)

        assert blockers, "returning to draft must be refused once someone has applied"
        assert any(b.id == "no_applications_yet" for b in blockers)

    def test_the_transition_is_allowed_when_none_does(self, application_count):
        application_count(0)

        assert evaluate_transition(_market(), MarketPhase.DRAFT, None) == []

    def test_the_guard_is_registered_on_the_edge(self):
        assert ("applications_open", "draft") in guards.TRANSITION_GUARDS


class TestWhatItDoesNotChange:
    """D9 is untouched: once an applicant has submitted, the form they answered cannot move."""

    def test_a_market_with_applications_still_cannot_reach_draft(self, application_count):
        application_count(1)

        assert evaluate_transition(_market(), MarketPhase.DRAFT, None) != []

    def test_opening_applications_again_is_still_possible(self):
        assert ("draft", "applications_open") in VALID_TRANSITIONS
