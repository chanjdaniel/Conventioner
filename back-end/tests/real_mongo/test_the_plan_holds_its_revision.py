"""A plan save lands only on the plan it was judged on, and never after the market left draft.

The plan write reads the market, judges the plan against it (the setup settles on leaving draft,
the assignment rules on Publish results), and then writes the plan whole. Each test lands a second
change between that read and the write (``interleave``): Open applications, Publish results, or
another save of the plan. Each asserts what a person and a later reader see: the 409 and its
sentence, and the stored plan as the other change left it. The other writers of the plan, the CSV
start and the floorplan save, count the revision, so a Market Setup page read before them is
refused. The last tests run the other way round: a plan save landing inside Open applications'
window refuses the move.
"""
import copy

import api.markets as MarketsApi
from datatypes import MarketPhase
from market_write import MARKET_CHANGED
from real_mongo.test_a_judged_write_lands_only_on_the_market_it_judged import (
    _history, _move, _stored,
)
from conftest import COMPLETE_PLAN
from test_csv_proposal_api import CSV as START_CSV

ORGANIZER = "fixture-organizer@example.com"
CHANGED = {"error": MARKET_CHANGED, "code": "market_changed"}
#: A form market a draft may open applications on: a form, and the review setup decided.
OPENABLE = {
    "intakeMode": "form", "nothingLeadsTheCard": True, "noAutomaticRejections": True,
    "applicationForm": {"fields": [{"key": "shop_name", "label": "Shop name", "type": "text",
                                    "required": False, "options": [], "order": 0}],
                        "publishedAt": None, "essentialOptions": None, "unaskedEssentials": []},
}
#: The fixture's own market day, and one more an organizer adds on Market Setup.
FIRST_DAY = COMPLETE_PLAN["marketDates"][0]["date"]
ANOTHER_DAY = "2099-08-02"


def _plan(**changes):
    return {**copy.deepcopy(COMPLETE_PLAN), **changes}


def _with_another_day():
    return _plan(marketDates=[{"date": FIRST_DAY}, {"date": ANOTHER_DAY}])


def _with_a_renamed_section():
    plan = _plan()
    plan["sections"][1]["name"] = "Fixture Courtyard"
    return plan


def _days(document):
    return [day["date"] for day in document["setupObject"]["marketDates"]]


def _sections(document):
    return [section["name"] for section in document["setupObject"]["sections"]]


def _save(client, market, setup_object, **body):
    return client.put(f"/markets/{market['id']}/plan", json={"setupObject": setup_object, **body})


def _served_revision(client, market):
    return client.get(f"/markets/{market['id']}").get_json()["market"]["planRevision"]


class TestAPlanSaveCrossingOpenApplications:
    def test_is_refused_and_leaves_the_plan_as_it_opened(
            self, signed_in, market_in, interleave, real_db, market_records):
        """The setup settles on leaving draft: a date judged editable in draft, landing after the
        market opened, would move a day applicants were already choosing."""
        client = signed_in(ORGANIZER)
        market = market_in(MarketPhase.DRAFT, **OPENABLE)
        interleave("api.markets._load_market_and_organization_to_change",
                   _move(market, MarketPhase.APPLICATIONS))

        response = _save(client, market, _with_another_day(), planRevision=0)

        assert response.status_code == 409, response.get_json()
        assert response.get_json() == CHANGED
        stored = _stored(real_db, market)
        assert stored["phase"] == MarketPhase.APPLICATIONS.value
        assert _days(stored) == [FIRST_DAY]
        assert _history(market_records, market) == []


class TestAPlanSaveCrossingPublishResults:
    def test_is_refused_and_leaves_the_rules_as_published(
            self, signed_in, market_in, interleave, real_db, market_records):
        """The assignment rules settle on Publish results, which moves no phase, so only the flag
        held tells the save it crossed it."""
        client = signed_in(ORGANIZER)
        market = market_in(MarketPhase.ASSIGNMENT)
        interleave("api.markets._load_market_and_organization_to_change",
                   lambda: real_db["markets"].update_one(
                       {"id": market["id"]}, {"$set": {"resultsPublished": True}}))

        response = _save(client, market, _plan(assignmentOptions={"maxAssignmentsPerVendor": 1}),
                         planRevision=0)

        assert response.status_code == 409, response.get_json()
        assert response.get_json() == CHANGED
        stored = _stored(real_db, market)
        assert stored["resultsPublished"] is True
        assert stored["setupObject"]["assignmentOptions"] == {}
        assert _history(market_records, market) == []


class TestTwoSavesOfOnePlan:
    def test_the_save_from_the_older_copy_is_refused_and_the_first_stands(
            self, signed_in, market_in, real_db, market_records):
        """Two pages opened on one draft: the first adds a day, the second, read before it,
        renames a section from its older copy, which would put the day back as it was."""
        client = signed_in(ORGANIZER)
        market = market_in(MarketPhase.DRAFT)
        assert _served_revision(client, market) == 0

        first = _save(client, market, _with_another_day(), planRevision=0)
        second = _save(client, market, _with_a_renamed_section(), planRevision=0)

        assert first.status_code == 200, first.get_json()
        assert first.get_json() == {"message": "Plan saved", "planRevision": 1}
        assert second.status_code == 409, second.get_json()
        assert second.get_json() == CHANGED
        stored = _stored(real_db, market)
        assert _days(stored) == [FIRST_DAY, ANOTHER_DAY]
        assert _sections(stored) == ["Main Hall", "Garden"]
        assert stored["planRevision"] == 1
        assert [entry["kind"] for entry in _history(market_records, market)] == ["plan"]
        assert _served_revision(client, market) == 1

    def test_a_save_from_the_revision_it_answered_lands(self, signed_in, market_in, real_db):
        client = signed_in(ORGANIZER)
        market = market_in(MarketPhase.DRAFT)

        first = _save(client, market, _with_another_day(), planRevision=0)
        both = _with_a_renamed_section()
        both["marketDates"] = [{"date": FIRST_DAY}, {"date": ANOTHER_DAY}]
        second = _save(client, market, both, planRevision=first.get_json()["planRevision"])

        assert second.status_code == 200, second.get_json()
        assert second.get_json()["planRevision"] == 2
        stored = _stored(real_db, market)
        assert _days(stored) == [FIRST_DAY, ANOTHER_DAY]
        assert _sections(stored) == ["Main Hall", "Fixture Courtyard"]


class TestTheOtherWritersOfThePlan:
    def test_the_csv_start_counts_the_revision_so_a_setup_page_open_from_before_is_refused(
            self, signed_in, market_in, real_db):
        """The start writes the plan from its file, and no page sent it a revision: a Market Setup
        page read before it is told the market changed rather than storing its copy over it."""
        client = signed_in(ORGANIZER)
        market = market_in(MarketPhase.DRAFT, applicationForm={"fields": []})
        read = _served_revision(client, market)

        started = client.post(f"/markets/{market['id']}/csv-proposal/confirm",
                              json={"csvContent": START_CSV, "year": 2026})
        saved = _save(client, market, _with_another_day(), planRevision=read)

        assert started.status_code == 200, started.get_json()
        assert saved.status_code == 409, saved.get_json()
        assert saved.get_json() == CHANGED
        assert ANOTHER_DAY not in _days(_stored(real_db, market))
        assert _served_revision(client, market) == read + 1

    def test_the_csv_start_is_refused_over_a_plan_saved_while_it_read_its_file(
            self, signed_in, market_in, interleave, real_db, market_records):
        """The start builds the plan from the one it read: a plan saved meanwhile would be
        written over, so the start holds the revision as it read it."""
        client = signed_in(ORGANIZER)
        market = market_in(MarketPhase.DRAFT, applicationForm={"fields": []})
        interleave("csv_start.confirmed_update", lambda: MarketsApi.save_plan(
            market["id"], {"setupObject": _with_another_day(), "planRevision": 0}, ORGANIZER))

        started = client.post(f"/markets/{market['id']}/csv-proposal/confirm",
                              json={"csvContent": START_CSV, "year": 2026})

        assert started.status_code == 409, started.get_json()
        assert started.get_json() == CHANGED
        stored = _stored(real_db, market)
        assert _days(stored) == [FIRST_DAY, ANOTHER_DAY]
        assert stored["planRevision"] == 1
        assert [entry["kind"] for entry in _history(market_records, market)] == ["plan"]

    def test_the_floorplan_save_counts_the_revision_so_a_setup_page_open_from_before_is_refused(
            self, signed_in, market_in, real_db):
        client = signed_in(ORGANIZER)
        market = market_in(MarketPhase.DRAFT)
        read = _served_revision(client, market)

        floorplan = client.post("/floorplans/save-to-market", json={
            "market_id": market["id"], "floorplan": {"id": "fixture-floorplan"}})
        saved = _save(client, market, _with_another_day(), planRevision=read)

        assert floorplan.status_code == 200, floorplan.get_json()
        assert saved.status_code == 409, saved.get_json()
        assert saved.get_json() == CHANGED
        stored = _stored(real_db, market)
        assert ANOTHER_DAY not in _days(stored)
        assert [plan["id"] for plan in stored["setupObject"]["floorplans"]] == ["fixture-floorplan"]
        assert _served_revision(client, market) == read + 1

    def test_the_floorplan_save_is_refused_over_a_plan_saved_while_it_built_its_plan(
            self, signed_in, market_in, interleave, real_db, market_records):
        """The floorplan save builds the plan from the one it read, so it holds that revision."""
        client = signed_in(ORGANIZER)
        market = market_in(MarketPhase.DRAFT)
        interleave("api.floorplans_save._parsed_floorplan", lambda: MarketsApi.save_plan(
            market["id"], {"setupObject": _with_another_day(), "planRevision": 0}, ORGANIZER))

        floorplan = client.post("/floorplans/save-to-market", json={
            "market_id": market["id"], "floorplan": {"id": "fixture-floorplan"}})

        assert floorplan.status_code == 409, floorplan.get_json()
        assert floorplan.get_json() == CHANGED
        stored = _stored(real_db, market)
        assert _days(stored) == [FIRST_DAY, ANOTHER_DAY]
        assert stored["setupObject"]["floorplans"] == []
        assert [entry["kind"] for entry in _history(market_records, market)] == ["plan"]


class TestWhatDoesNotCountTheRevision:
    def test_a_phase_move_does_not_count_it(self, signed_in, market_in, real_db):
        """A move changes no part of the plan, so it counts nothing."""
        signed_in(ORGANIZER)
        market = market_in(MarketPhase.DRAFT, planRevision=3, **OPENABLE)

        _move(market, MarketPhase.APPLICATIONS)()

        stored = _stored(real_db, market)
        assert stored["phase"] == MarketPhase.APPLICATIONS.value
        assert stored["planRevision"] == 3


class TestTheRevisionTheBodyCarries:
    def test_a_save_carrying_none_is_told_the_market_changed(
            self, signed_in, market_in, real_db, market_records):
        """The page from before the revision existed, still open after a deploy, is told to
        reload rather than storing its copy over whatever was saved since."""
        client = signed_in(ORGANIZER)
        market = market_in(MarketPhase.DRAFT)

        response = _save(client, market, _with_another_day())

        assert response.status_code == 409, response.get_json()
        assert response.get_json() == CHANGED
        assert _days(_stored(real_db, market)) == [FIRST_DAY]
        assert _history(market_records, market) == []

    def test_a_save_carrying_something_else_is_refused_in_words(
            self, signed_in, market_in, real_db):
        client = signed_in(ORGANIZER)
        market = market_in(MarketPhase.DRAFT)

        for revision in (-1, 1.5, "1", True, None):
            response = _save(client, market, _with_another_day(), planRevision=revision)

            assert response.status_code == 400, (revision, response.get_json())
            assert response.get_json()["error"] == "planRevision must be a whole number."
        assert _days(_stored(real_db, market)) == [FIRST_DAY]


class TestOpenApplicationsCrossingAPlanSave:
    def test_is_refused_with_the_market_changed_and_the_market_stays_a_draft(
            self, signed_in, market_in, interleave, real_db, market_records):
        """The move judged the plan as read: a plan saved in its window would open a market on
        dates its guards never read, so the move is refused, and the rail says why."""
        client = signed_in(ORGANIZER)
        market = market_in(MarketPhase.DRAFT, **OPENABLE)
        interleave("api.markets.evaluate_transition", lambda: MarketsApi.save_plan(
            market["id"], {"setupObject": _with_another_day(), "planRevision": 0}, ORGANIZER))

        response = client.post(f"/markets/{market['id']}/transition",
                               json={"toPhase": MarketPhase.APPLICATIONS.value})

        assert response.status_code == 409, response.get_json()
        body = response.get_json()
        assert (body["currentPhase"], body["targetPhase"]) == (
            MarketPhase.DRAFT.value, MarketPhase.APPLICATIONS.value)
        assert [(b["id"], b["message"]) for b in body["blockers"]] == [
            ("market_changed", MARKET_CHANGED)]
        stored = _stored(real_db, market)
        assert stored["phase"] == MarketPhase.DRAFT.value
        assert _days(stored) == [FIRST_DAY, ANOTHER_DAY]
        assert [entry["kind"] for entry in _history(market_records, market)] == ["plan"]

    def test_lands_when_nothing_was_saved_in_its_window(self, signed_in, market_in, real_db):
        client = signed_in(ORGANIZER)
        market = market_in(MarketPhase.DRAFT, **OPENABLE)

        response = client.post(f"/markets/{market['id']}/transition",
                               json={"toPhase": MarketPhase.APPLICATIONS.value})

        assert response.status_code == 200, response.get_json()
        assert _stored(real_db, market)["phase"] == MarketPhase.APPLICATIONS.value
