"""The Stats tab's Room: the tables asked against the plan's tables, per market day and per tier
(T201).

Asked counts every main application the review has not rejected, those added by hand among them,
on each date it is available: a full table or "either" as 1, a half table as 0.5. It is a ceiling,
as the dates are: someone available three days who wants two counts on all three, and someone who
takes either size counts a whole table. Per tier, an application counts toward every tier it
accepts on that date, so the tier rows can add up to more than the day rows. A date or tier the
plan no longer offers is not counted, as the solver would not read it.

Tables are the plan's: every section is there on every date, so a day has the sum of the sections'
tables, and a tier the sum of its sections' tables over the market's dates. The tier rows are left
out of a plan of fewer than two tiers, where they would repeat the days.
"""
import copy

from conftest import FakeMarketsCollection, stored_market
import api.markets as MarketsApi
import market_stats as MarketStats
from datatypes import MarketPhase
from market_documents import market_from_document

SAT, SUN, MON = "2099-08-01", "2099-08-02", "2099-08-03"

PLAN = {
    "priority": [],
    "marketDates": [{"date": SAT}, {"date": SUN}],
    "tiers": [{"id": 0, "name": "Gold"}, {"id": 1, "name": "Silver"}],
    "locations": [{"name": "Hall"}],
    "sections": [
        {"name": "Front", "count": 4, "location": {"name": "Hall"},
         "tier": {"id": 0, "name": "Gold"}},
        {"name": "Back", "count": 6, "location": {"name": "Hall"},
         "tier": {"id": 1, "name": "Silver"}},
    ],
    "assignmentOptions": {},
    "floorplans": [],
}


def _answers(dates, choice="full", tiers=None):
    """An applicant's essential answers: the dates they can come, a table size, and the tiers they
    accept on each of those dates (Gold everywhere unless told)."""
    return {
        "essential_full_name": "A Vendor",
        "essential_available_dates": list(dates),
        "essential_max_dates": len(dates),
        "essential_table_choice": choice,
        "essential_tier_preference": tiers if tiers is not None else {
            date: ["Gold"] for date in dates
        },
        "essential_section_ranking": ["Front", "Back"],
    }


def _application(email, form_data, status="open", **more):
    return {
        "id": f"app-{email}", "market_id": "market-123", "applicant_email": email,
        "form_data": form_data, "status": status, "application_type": "main",
        "submitted_at": "2099-06-01T12:00:00Z", "updated_at": "2099-06-01T12:00:00Z", **more,
    }


def _market(plan=PLAN, phase=MarketPhase.APPLICATIONS):
    return market_from_document(stored_market(phase, setupObject=copy.deepcopy(plan)))


def _room(applications, plan=PLAN, phase=MarketPhase.APPLICATIONS):
    return MarketStats.count_room(_market(plan, phase), applications)


def _days(room):
    return [(row["date"], row["asked"], row["tables"]) for row in room["dates"]]


def _tiers(room):
    return [(row["tier"], row["asked"], row["tables"]) for row in room["tiers"]]


class TestTablesAskedPerDay:
    def test_a_full_table_and_either_count_one_and_a_half_table_half(self):
        room = _room([
            _application("full@vendor.test", _answers([SAT, SUN], "full")),
            _application("either@vendor.test", _answers([SAT], "either")),
            _application("half@vendor.test", _answers([SAT, SUN], "half")),
        ])

        assert _days(room) == [(SAT, 2.5, 10), (SUN, 1.5, 10)]

    def test_someone_available_every_day_counts_on_every_day_whatever_they_want(self):
        wants_one = _answers([SAT, SUN])
        wants_one["essential_max_dates"] = 1

        assert _days(_room([_application("one@vendor.test", wants_one)])) == [
            (SAT, 1, 10), (SUN, 1, 10),
        ]

    def test_a_rejected_and_a_waitlist_application_are_left_out(self):
        room = _room([
            _application("open@vendor.test", _answers([SAT])),
            _application("approved@vendor.test", _answers([SAT]), status="reviewer_approved"),
            _application("follow@vendor.test", _answers([SAT]), status="needs_follow_up"),
            _application("rejected@vendor.test", _answers([SAT]), status="reviewer_rejected"),
            _application("open@vendor.test", _answers([SAT]), application_type="waitlist",
                         id="app-waitlist"),
        ])

        assert _days(room)[0] == (SAT, 3, 10)

    def test_a_vendor_added_by_hand_is_counted(self):
        room = _room([
            _application("walk.in@example.com", _answers([SUN]), status="reviewer_approved",
                         added_by={"email": "owner@market.test"},
                         added_at="2099-06-02T12:00:00Z", submitted_at=None),
        ])

        assert _days(room) == [(SAT, 0, 10), (SUN, 1, 10)]

    def test_a_date_the_plan_no_longer_offers_is_not_counted(self):
        # Applied for Monday too, before the organizer took Monday off the plan.
        room = _room([_application("mon@vendor.test", _answers([SAT, MON]))])

        assert _days(room) == [(SAT, 1, 10), (SUN, 0, 10)]

    def test_an_organizers_update_of_the_dates_is_read_in_their_place(self):
        updated = _application("moved@vendor.test", _answers([SAT]), answer_updates={
            "essential_available_dates": {
                "value": [SUN], "by": {"email": "owner@market.test"},
                "at": "2099-06-03T12:00:00Z",
            },
        })

        assert _days(_room([updated])) == [(SAT, 0, 10), (SUN, 1, 10)]

    def test_a_draft_shows_its_tables_with_nothing_asked(self):
        room = _room([], phase=MarketPhase.DRAFT)

        assert _days(room) == [(SAT, 0, 10), (SUN, 0, 10)]
        assert _tiers(room) == [("Gold", 0, 8), ("Silver", 0, 12)]

    def test_a_plan_with_no_dates_has_no_room_to_tell(self):
        no_dates = {**PLAN, "marketDates": []}

        assert _room([], plan=no_dates) is None

    def test_a_market_with_no_plan_has_no_room_to_tell(self):
        market = market_from_document(stored_market(MarketPhase.DRAFT))

        assert MarketStats.count_room(market, []) is None


class TestTablesAskedPerTier:
    def test_each_tier_has_its_sections_tables_over_the_dates(self):
        assert _tiers(_room([])) == [("Gold", 0, 8), ("Silver", 0, 12)]

    def test_an_application_accepting_two_tiers_on_a_date_counts_in_both(self):
        both = _answers([SAT, SUN], tiers={SAT: ["Gold", "Silver"], SUN: ["Silver"]})

        room = _room([_application("both@vendor.test", both)])

        assert _days(room) == [(SAT, 1, 10), (SUN, 1, 10)]
        # Three table-days asked across the tiers, from two days asked.
        assert _tiers(room) == [("Gold", 1, 8), ("Silver", 2, 12)]

    def test_a_half_table_counts_half_in_each_tier_it_accepts(self):
        half = _answers([SAT], "half", tiers={SAT: ["Gold", "Silver"]})

        assert _tiers(_room([_application("half@vendor.test", half)])) == [
            ("Gold", 0.5, 8), ("Silver", 0.5, 12),
        ]

    def test_a_tier_the_plan_no_longer_offers_is_not_counted(self):
        bronze = _answers([SAT], tiers={SAT: ["Bronze"]})

        room = _room([_application("bronze@vendor.test", bronze)])

        assert _days(room)[0] == (SAT, 1, 10)
        assert _tiers(room) == [("Gold", 0, 8), ("Silver", 0, 12)]

    def test_a_vendor_never_asked_their_tiers_counts_in_every_tier_as_the_solver_reads_them(self):
        # The form froze before the plan had tiers, so nobody was asked (bug 23).
        unasked = _answers([SAT], tiers={})

        assert _tiers(_room([_application("early@vendor.test", unasked)])) == [
            ("Gold", 1, 8), ("Silver", 1, 12),
        ]

    def test_a_plan_of_one_tier_has_no_tier_rows(self):
        one_tier = {**PLAN, "tiers": [PLAN["tiers"][0]], "sections": [PLAN["sections"][0]]}

        room = _room([_application("gold@vendor.test", _answers([SAT]))], plan=one_tier)

        assert _days(room) == [(SAT, 1, 4), (SUN, 0, 4)]
        assert room["tiers"] == []


class TestTheRoute:
    def test_the_stats_answer_carries_the_room_from_draft_on(
        self, monkeypatch, applications,
    ):
        import api.permissions as PermissionsApi

        doc = stored_market(MarketPhase.DRAFT, setupObject=copy.deepcopy(PLAN))
        monkeypatch.setattr(MarketsApi, "markets_collection", FakeMarketsCollection(doc))
        monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_k: True)

        market = MarketsApi.load_market_context("market-123").market
        room = MarketStats.stats_for_market(market)["room"]

        assert _days(room) == [(SAT, 0, 10), (SUN, 0, 10)]
        assert _tiers(room) == [("Gold", 0, 8), ("Silver", 0, 12)]
