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
from conftest import review_setup_decided
from datatypes import (
    AssignmentObject, AssignmentOptionObject, FloorplanObject, FloorplanTable, FormField,
    ApplicationForm, IntakeMode, LocationObject, Market,
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
        # Its review setup decided (T206): the setup is what these lines are about.
        **review_setup_decided(),
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


# ── A layout's tables are each in a section (T257) ────────────────────────────

UPPER = LocationObject(id="loc-upper", name="Upper Hall")
LOWER = LocationObject(id="loc-lower", name="Lower Hall")
GOLD_ROW = SectionObject(id="sec-gold", name="Gold row", location=UPPER, tier=GOLD, count=2)
BRONZE = SectionObject(id="sec-bronze", name="Bronze corner", location=LOWER, tier=GOLD, count=4)


def _table(section_id, number):
    return FloorplanTable(
        section_id=section_id, number=number, table_type_id="six-foot", x_mm=1000, y_mm=1000)


def _laid_out(*tables, location=UPPER, floorplan_id="fp-upper"):
    return FloorplanObject(id=floorplan_id, location_id=location.id, tables=list(tables))


def _market_with(*floorplans, sections=(GOLD_ROW, BRONZE)):
    market = _market(locations=(UPPER, LOWER), sections=list(sections))
    market.setup_object.floorplans = list(floorplans)
    return market


def test_a_layout_with_every_table_in_a_section_leaves_draft():
    market = _market_with(_laid_out(_table("sec-gold", 1), _table("sec-gold", 2)))
    assert _blockers(market) == []


def test_a_layout_with_tables_in_no_section_is_refused_naming_the_location_and_how_many():
    market = _market_with(_laid_out(
        _table("sec-gold", 1), _table(None, None), _table(None, None), _table(None, None)))
    blockers = _blockers(market)
    assert [blocker.id for blocker in blockers] == ["layout_tables_have_sections"]
    assert blockers[0].message == (
        "Upper Hall's layout has 3 tables in no section. Put them in a section or remove them.")


def test_one_table_in_no_section_is_said_as_one():
    market = _market_with(_laid_out(_table("sec-gold", 1), _table(None, None)))
    assert _blockers(market)[0].message == (
        "Upper Hall's layout has 1 table in no section. Put it in a section or remove it.")


def test_its_fix_leads_to_that_locations_layout_under_the_market_setup_action():
    market = _market_with(
        _laid_out(_table("sec-gold", 1)),
        _laid_out(_table("sec-bronze", 1), _table(None, None),
                  location=LOWER, floorplan_id="fp-lower"),
    )
    blocker = _blockers(market)[0]
    assert "Lower Hall's layout" in blocker.message
    assert blocker.resolution_link == "layout/loc-lower"
    assert blocker.resolution_label == "Open the layout"
    assert blocker.resolution_action == "change-setup"


def test_a_table_of_a_section_that_is_gone_is_in_no_section():
    """Removing a section on Section Setup leaves its tables on the layout, still naming it."""
    market = _market_with(
        _laid_out(_table("sec-gold", 1), _table("sec-removed", 1), _table("sec-removed", 2)))
    assert "2 tables in no section" in _blockers(market)[0].message


def test_a_table_of_another_locations_section_is_in_no_section():
    market = _market_with(_laid_out(_table("sec-gold", 1), _table("sec-bronze", 1)))
    assert "1 table in no section" in _blockers(market)[0].message


def test_the_first_layout_in_the_way_is_the_one_named():
    market = _market_with(
        _laid_out(_table("sec-gold", 1), _table(None, None)),
        _laid_out(_table("sec-bronze", 1), _table(None, None),
                  location=LOWER, floorplan_id="fp-lower"),
    )
    blockers = _blockers(market)
    assert len(blockers) == 1
    assert blockers[0].resolution_link == "layout/loc-upper"


def test_a_floorplan_of_no_location_is_not_a_layout():
    """A beta floorplan, of no location, is ignored until the migration removes it."""
    beta = FloorplanObject(id="fp-beta", location_id=None, tables=[_table(None, None)])
    assert _blockers(_market_with(beta)) == []


def test_a_location_id_is_written_into_the_link_as_one_step_of_the_address():
    odd = LocationObject(id="hall/1 a", name="Odd Hall")
    section = SectionObject(id="sec-odd", name="Odd row", location=odd, tier=GOLD, count=1)
    market = _market(locations=(odd,), sections=[section])
    market.setup_object.floorplans = [
        FloorplanObject(id="fp-odd", location_id=odd.id, tables=[_table(None, None)])]
    assert _blockers(market)[0].resolution_link == "layout/hall%2F1%20a"
