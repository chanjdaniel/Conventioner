"""What a Google Form's responses say about the market plan (E24/F02/S02).

The dates, the tiers best first and the ceiling on days per vendor, held to the answers written by
hand for the form-started-from-a-CSV map (ticket 03) on the five anonymised exports, and the year
the stated weekdays fit. Where the plan already has dates or tiers, the file's are matched against
them and a difference comes back to settle: the organizer's plan wins and is never added to.
"""
import csv
import os

import pytest

import csv_proposal as CsvProposal

CORPUS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_data", "google_forms")

ANSWERS = {
    "fall-2025": {"dates": ["11-17", "11-18", "11-19", "11-20", "11-21"], "year": 2025,
                  "tiers": ["Gold", "Silver", "Bronze"], "ceiling": None},
    "spring-2024": {"dates": ["03-25", "03-26", "03-27", "03-28"], "year": 2024,
                    "tiers": ["Gold", "Silver", "Bronze"], "ceiling": 3},
    "spring-2025": {"dates": ["03-17", "03-18", "03-19", "03-20", "03-21"], "year": 2025,
                    "tiers": ["Gold", "Silver", "Bronze"], "ceiling": 2},
    "fall-2023": {"dates": ["11-20", "11-21", "11-22", "11-23", "11-24"], "year": 2023,
                  "tiers": [], "ceiling": None},
    "spring-2026": {"dates": ["03-23", "03-24", "03-25", "03-26", "03-27"], "year": 2026,
                    "tiers": ["Gold", "Silver"], "ceiling": None},
}


def _plan(name, market_doc=None):
    with open(os.path.join(CORPUS, f"{name}.csv"), newline="", encoding="utf-8") as handle:
        rows = list(csv.reader(handle))
    headers = [header.strip() for header in rows[0]]
    return CsvProposal.proposal(headers, rows[1:], market_doc)["plan"]


def _month_day(date):
    return f"{date['month']:02d}-{date['day']:02d}"


@pytest.mark.parametrize("name", ANSWERS)
def test_the_dates_are_the_files_market_days(name):
    assert [_month_day(d) for d in _plan(name)["dates"]] == ANSWERS[name]["dates"]


@pytest.mark.parametrize("name", ANSWERS)
def test_the_year_is_the_one_the_weekdays_fit(name):
    assert _plan(name)["year"] == ANSWERS[name]["year"]


@pytest.mark.parametrize("name", ANSWERS)
def test_the_tiers_are_best_first(name):
    assert [tier["name"] for tier in _plan(name)["tiers"]] == ANSWERS[name]["tiers"]


@pytest.mark.parametrize("name", ANSWERS)
def test_the_ceiling_is_read_from_the_headers_prose(name):
    ceiling = _plan(name)["ceiling"]
    want = ANSWERS[name]["ceiling"]
    if want is None:
        assert ceiling is None
    else:
        assert ceiling["days"] == want
        # The sentence it came from, and not the whole header around it.
        assert CsvProposal.CEILING.search(ceiling["sentence"])
        assert len(ceiling["sentence"]) < 300


def _proposal(headers, rows, market_doc=None):
    return CsvProposal.proposal(headers, rows, market_doc)["plan"]


GRID = "Choose your tiers [{}]"


def _tier_file(days, tiers_per_row):
    headers = ["Timestamp", "Email Address"] + [GRID.format(day) for day in days]
    rows = [[f"1/{i + 1}/2026 9:00:00", f"p{i}@mail.test"] + [answer] * len(days)
            for i, answer in enumerate(tiers_per_row)]
    return headers, rows


def test_weekdays_that_fit_no_year_propose_none():
    # 17 March is never a Monday and a Tuesday at once.
    headers, rows = _tier_file(["Monday, March 17", "Monday, March 18"], ["Gold"] * 5)
    assert _proposal(headers, rows)["year"] is None


def test_a_file_with_no_dates_proposes_none_and_asks_no_year():
    headers = ["Timestamp", "Email Address", "Business name"]
    rows = [[f"1/{i + 1}/2026 9:00:00", f"p{i}@mail.test", f"Shop {i}"] for i in range(5)]
    plan = _proposal(headers, rows)
    assert plan["dates"] == [] and plan["year"] is None


def _market_with(tiers=(), dates=()):
    return {
        "id": "market-1", "phase": "draft",
        "setupObject": {
            "tiers": [{"id": i, "name": name} for i, name in enumerate(tiers)],
            "marketDates": [{"date": date} for date in dates],
            "priority": [], "locations": [], "sections": [], "assignmentOptions": {},
        },
    }


def test_a_tier_the_plan_does_not_have_comes_back_to_settle():
    headers, rows = _tier_file(["Saturday, March 7"], ["Gold"] * 3 + ["Silver"] * 3 + ["Bronze"] * 3)
    market = _market_with(tiers=["Gold", "Silver"])
    plan = _proposal(headers, rows, market)
    by_name = {tier["name"]: tier for tier in plan["tiers"]}
    assert by_name["Gold"]["matches"] == "Gold"
    assert by_name["Bronze"]["matches"] is None
    assert [d for d in plan["disagreements"] if d["kind"] == "tier"] == [
        {"kind": "tier", "value": "Bronze"}]
    assert [t["name"] for t in market["setupObject"]["tiers"]] == ["Gold", "Silver"]


def test_the_plans_dates_are_matched_by_month_and_day():
    headers, rows = _tier_file(["Saturday, March 7", "Sunday, March 8"], ["Gold"] * 5)
    plan = _proposal(headers, rows, _market_with(dates=["2026-03-07"]))
    matches = {_month_day(d): d["matches"] for d in plan["dates"]}
    assert matches == {"03-07": "2026-03-07", "03-08": None}
    assert {"kind": "date", "value": "Sunday, March 8"} in plan["disagreements"]


def test_a_plan_with_nothing_yet_takes_the_files_values_without_disagreeing():
    headers, rows = _tier_file(["Saturday, March 7"], ["Gold"] * 5)
    plan = _proposal(headers, rows, _market_with())
    assert plan["disagreements"] == []
