"""The application-form lock is part of the market every screen reads (E21/F02/S03).

The form builder used to ask for the lock once, on mount, from the form's own endpoint - so a
transition fired from the phase rail never reached it: opening applications left Add field live
until the organizer changed tabs, and reopening left a notice naming a phase the rail contradicted.
The lock depends on the phase AND on whether an application exists, and only the server knows the
second, so the single-market read carries it: after any write the store re-reads the market, and
the lock arrives with it.

It is computed by the one rule (``application_form_lock_reason``) and served, never stored: no
request body can write it.
"""
from types import SimpleNamespace

import pytest

import api.markets as MarketsApi
import api.organizations as OrgsApi
import api.permissions as PermissionsApi
import api.users as UsersApi
from datatypes import MarketPhase, MarketRole

USER_ID = "user-1"
USER_EMAIL = "owner@example.com"


class FakeMarketsCollection:
    def __init__(self, doc):
        self.doc = doc

    def find_one(self, query, projection=None):
        return dict(self.doc) if query.get("id") == self.doc["id"] else None


def _stored(phase: MarketPhase) -> dict:
    return {
        "_id": "mongo-m1",
        "id": "m1",
        "name": "Riverside",
        "creationDate": "2026-01-01T00:00:00Z",
        "roles": {USER_ID: MarketRole.OWNER.value},
        "modificationList": [],
        "assignmentObject": {"vendorAssignments": [], "assignmentStatistics": None},
        "phase": phase.value,
        "isDraft": phase == MarketPhase.DRAFT,
    }


@pytest.fixture
def serve(monkeypatch, applications):
    monkeypatch.setattr(
        UsersApi, "get_user", lambda _email: SimpleNamespace(id=USER_ID, email=USER_EMAIL)
    )
    monkeypatch.setattr(UsersApi, "get_user_by_id", lambda _uid: None)
    monkeypatch.setattr(OrgsApi, "get_organization", lambda _oid: None)
    monkeypatch.setattr(
        PermissionsApi, "get_user_market_role", lambda *_args, **_kwargs: MarketRole.OWNER
    )

    def read(phase: MarketPhase, applications_submitted: int = 0) -> dict:
        monkeypatch.setattr(MarketsApi, "markets_collection", FakeMarketsCollection(_stored(phase)))
        applications.count = applications_submitted
        return MarketsApi.get_market_for_user(USER_EMAIL, "m1")

    return read


def test_a_draft_nobody_has_applied_to_is_editable(serve):
    assert serve(MarketPhase.DRAFT)["applicationFormLockReason"] is None


def test_a_draft_somebody_has_applied_to_is_locked_for_good(serve):
    reason = serve(MarketPhase.DRAFT, applications_submitted=1)["applicationFormLockReason"]

    assert "already been submitted" in reason


@pytest.mark.parametrize(
    "phase", [phase for phase in MarketPhase if phase != MarketPhase.DRAFT]
)
def test_every_phase_after_draft_is_locked_and_says_which(serve, phase):
    reason = serve(phase)["applicationFormLockReason"]

    assert "only be edited while the market is in draft" in reason


def test_it_cannot_be_written(monkeypatch):
    """A market body naming the lock is a body naming a field the market does not have."""
    from conftest import client_market

    market = client_market(application_form_lock_reason="nothing to see here")

    assert "application_form_lock_reason" not in market.model_dump()


# The assignment rules' lock rides on the market the same way (E22/F02/S02): the rules page reads
# it from the market it holds, so a transition from the rail reaches it at once.
@pytest.mark.parametrize(
    "phase", [MarketPhase.OFFERS, MarketPhase.MARKET_DAYS, MarketPhase.ARCHIVED]
)
def test_once_the_assignment_is_settled_the_rules_say_so(serve, phase):
    assert "settled" in serve(phase)["assignmentRulesLockReason"]


@pytest.mark.parametrize(
    "phase",
    [
        MarketPhase.DRAFT,
        MarketPhase.APPLICATIONS_OPEN,
        MarketPhase.APPLICATIONS_CLOSED,
        MarketPhase.REVIEW,
        MarketPhase.ASSIGNMENT,
    ],
)
def test_up_to_and_including_the_assignment_the_rules_are_open(serve, phase):
    assert serve(phase)["assignmentRulesLockReason"] is None


def test_the_market_says_what_changed_since_its_assignment_ran(serve, monkeypatch):
    """Served on the market like the locks (E22/F03/S01); computed by ``made_from``, tested there."""
    import assignment.made_from as MadeFrom

    monkeypatch.setattr(MarketsApi, "changed_since_run", lambda _market: ["rules", "plan"])
    assert serve(MarketPhase.ASSIGNMENT)["assignmentOutOfDate"] == ["rules", "plan"]
    assert MadeFrom.GROUPS == ("rules", "plan", "applications")


def test_a_market_with_no_assignment_is_not_out_of_date(serve):
    assert serve(MarketPhase.ASSIGNMENT)["assignmentOutOfDate"] == []
