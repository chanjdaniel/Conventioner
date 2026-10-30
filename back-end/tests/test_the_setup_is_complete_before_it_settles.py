"""Leaving draft requires a complete setup (E31/F01/S01).

The setup settles when the market leaves draft, so a setup that leaves incomplete can never be
completed. Each part of it is its own blocker line, naming what is missing and pointing at Market
Setup: dates, none of them already passed; a location; and tables at every tier. The walk's CSV
market left draft with three tiers and no tables, and first heard of it in review, as a blocker
listing 90 addresses.
"""
from datetime import datetime, timedelta, timezone

import pytest

import guards
from datatypes import (
    AssignmentObject, AssignmentOptionObject, FormField, ApplicationForm, IntakeMode, LocationObject,
    Market,
    MarketDateObject, MarketPhase, MarketRole, SectionObject, SetupObject, TierObject,
)

SOON = (datetime.now(timezone.utc).date() + timedelta(days=30)).isoformat()
TODAY = datetime.now(timezone.utc).date().isoformat()
PAST = (datetime.now(timezone.utc).date() - timedelta(days=2)).isoformat()

GOLD = TierObject(id=1, name="Gold")
SILVER = TierObject(id=2, name="Silver")
HALL = LocationObject(name="Hall")


def _market(dates=(SOON,), tiers=(GOLD,), locations=(HALL,), sections=None):
    if sections is None:
        sections = [SectionObject(name="A", location=HALL, tier=GOLD, count=4)]
    return Market(
        name="Test Market", creation_date="2026-01-01", roles={"owner-1": MarketRole.OWNER},
        modification_list=[], assignment_object=AssignmentObject(), phase=MarketPhase.DRAFT,
        # Vendors apply on its page: the setup is all that stands between it and opening.
        intake_mode=IntakeMode.FORM,
        application_form=ApplicationForm(fields=[FormField(
            key="what", label="What do you sell?", type="text", required=False, options=[],
            order=0)]),
        setup_object=SetupObject(
            priority=[], market_dates=[MarketDateObject(date=d) for d in dates],
            tiers=list(tiers), locations=list(locations), sections=list(sections),
            assignment_options=AssignmentOptionObject(),
        ),
    )


def _blockers(market):
    return guards.evaluate_transition(market, "applications", None)


def test_a_complete_setup_leaves_draft():
    assert _blockers(_market()) == []


def test_a_market_dated_today_is_not_over():
    assert _blockers(_market(dates=(TODAY,))) == []


@pytest.mark.parametrize("utc_now, over", [
    # Five in the morning in London is still the evening of the 20th across the Pacific.
    ("2026-11-21T05:00:00+00:00", False),
    # By one in the afternoon, the 20th is over everywhere.
    ("2026-11-21T13:00:00+00:00", True),
])
def test_a_date_has_passed_once_it_has_passed_everywhere(monkeypatch, utc_now, over):
    """The server cannot know where a market is, so it never calls a date over that is still today
    for an organizer somewhere; any viewer's own calendar then agrees with every refusal."""
    monkeypatch.setattr(guards, "_utc_now", lambda: datetime.fromisoformat(utc_now))

    assert bool(_blockers(_market(dates=("2026-11-20",)))) is over


@pytest.mark.parametrize("market, names, fix", [
    (_market(dates=()), "no market dates", "Pick market dates"),
    (_market(locations=()), "no location", "Add a location"),
    (_market(sections=[]), "no tables", "Add tables"),
])
def test_each_missing_part_is_its_own_line_pointing_at_market_setup(market, names, fix):
    blockers = _blockers(market)
    assert len(blockers) == 1
    assert names in blockers[0].message
    assert blockers[0].resolution_link == "setup"
    # The rail's main button while the move waits on it (E32/F01/S02).
    assert blockers[0].resolution_label == fix


def test_every_missing_part_is_said_at_once():
    blockers = _blockers(_market(dates=(), locations=(), sections=[]))
    assert len(blockers) == 3


def test_dates_that_have_passed_are_named():
    blockers = _blockers(_market(dates=(PAST, SOON)))
    assert len(blockers) == 1
    assert "already passed" in blockers[0].message
    assert PAST in blockers[0].message or "passed" in blockers[0].message


def test_a_tier_with_no_tables_is_named_not_its_applicants():
    """The CSV start's shape: tiers, no sections. Said in draft, by tier, never by applicant."""
    blockers = _blockers(_market(tiers=(GOLD, SILVER)))
    assert len(blockers) == 1
    assert "Silver" in blockers[0].message
    assert "Gold" not in blockers[0].message


def test_a_section_with_no_tables_does_not_count():
    blockers = _blockers(_market(sections=[
        SectionObject(name="A", location=HALL, tier=GOLD, count=0)]))
    assert len(blockers) == 1
    assert "no tables" in blockers[0].message


def test_only_leaving_draft_asks_it():
    """Reopening closed applications re-enters the same phase, but the setup settled long ago."""
    for edge, guard_list in guards.TRANSITION_GUARDS.items():
        ids = {guard.id for guard in guard_list}
        complete = {"setup_has_dates", "setup_has_a_location", "every_tier_has_tables"}
        assert (complete <= ids) == (edge == ("draft", "applications")), edge
