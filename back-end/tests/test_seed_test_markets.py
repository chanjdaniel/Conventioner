"""Production's test markets, one of each intake path (E32/F03/S03).

The test markets were cleared after the 2026-10-18 dry run, so a check in production - did a sign-in
code arrive? does a Google Form market's sign-in read as absent? - had nothing to run against. The
seeder makes them again. What it writes goes through the product's own writes, which the E2E spec
`seed-test-markets.spec.ts` drives end to end; this file pins what it writes.
"""
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from assignment.utils import convert_keys_to_snake_case  # noqa: E402
from datatypes import ApplicationForm, IntakeMode, MarketPhase, SetupObject  # noqa: E402
from guards import evaluate_transition  # noqa: E402
import seed_test_markets as seeder  # noqa: E402
from conftest import client_market  # noqa: E402

TODAY = date(2026, 10, 19)


def test_there_is_one_test_market_of_each_intake_path():
    assert sorted(m.intake_mode for m in seeder.TEST_MARKETS) == sorted(IntakeMode)
    assert len({m.name for m in seeder.TEST_MARKETS}) == len(seeder.TEST_MARKETS)


def test_its_dates_are_saturdays_a_year_out_so_a_market_stays_open_long_after_it_is_seeded():
    dates = [d["date"] for d in seeder.test_plan(TODAY)["marketDates"]]

    assert dates and all(date.fromisoformat(d).weekday() == 5 for d in dates)
    assert all(date.fromisoformat(d) > date(2027, 10, 1) for d in dates)


def test_each_market_may_leave_draft_as_seeded():
    """The leaving-draft guards judge the plan and form the seeder writes, before it writes them."""
    for test_market in seeder.TEST_MARKETS:
        market = client_market(
            name=test_market.name,
            intake_mode=test_market.intake_mode,
            phase=MarketPhase.DRAFT,
            setup_object=SetupObject(**convert_keys_to_snake_case(seeder.test_plan(TODAY))),
            application_form=ApplicationForm(fields=seeder.TEST_FORM_FIELDS),
        )

        assert evaluate_transition(market, MarketPhase.APPLICATIONS_OPEN.value, db=None) == []


def test_nothing_it_writes_names_a_person():
    """No real applicant's details: the markets hold a plan and questions, and nobody's address."""
    written = repr((seeder.TEST_ORGANIZATION, seeder.TEST_MARKETS, seeder.test_plan(TODAY),
                    seeder.TEST_FORM_FIELDS))

    assert "@" not in written
