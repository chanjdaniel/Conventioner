"""A floorplan save leaves its market readable, whatever the market held and whatever was sent (T272).

The save used to write the floorplan's sections, locations and floorplan into the stored plan by
hand. On a market whose plan was never saved that made a plan of those three alone, which does not
parse, so the market answered as missing to every reader and refused every write, its own Delete
included; a hand-made body did the same with one wrong field, stored any key it carried, and every
save appended another copy of the floorplan. The save now parses the floorplan and writes through
the plan's own writer (``prepared_plan``), so what is stored is a plan that reads.

T257 made a floorplan a location's layout: the save no longer writes the plan's sections and
locations, which are Market Setup's, and holds the layout to its rules (``layout.layout_refusal``);
its sections count its tables through the plan writer (``layout.derive_counts``).

Each test reads what was written by applying the recorded ``$set`` to the document as it was and
parsing the result with ``market_from_document``, which is what every reader of the market does.
"""
import copy
import json
from types import SimpleNamespace

import pytest

from conftest import (
    FakeMarketsCollection,
    sessions_load_through_get_user,
    skip_without_real_dependencies,
    stored_market,
)

skip_without_real_dependencies()

import app as app_module
import api.market_actions as Actions
import api.markets as MarketsApi
import api.users as UsersApi
import history as History
import layout as Layout
from datatypes import MarketPhase
from market_documents import market_from_document
from utils.request_body import NOT_AN_OBJECT
import market_write as MarketWrite

MARKET_ID = "market-123"
ACCOUNTS = {
    "owner@example.com": "user-owner",
    "editor@example.com": "user-editor",
    "viewer@example.com": "user-viewer",
    "outsider@example.com": "user-outsider",
}
ROLES = {"user-owner": "owner", "user-editor": "editor", "user-viewer": "viewer"}

MAIN_HALL = {"id": "loc-main", "name": "Main Hall"}
OLD_HALL = {"id": "loc-old", "name": "Old Hall"}
SIX_FOOT = {"id": "tt-1", "name": "Standard 6 ft", "widthMm": 1830, "depthMm": 760}

#: A plan with something in every field, as Market Setup stores it: Hall A in Main Hall, Old Row
#: in Old Hall, and the market's one table type.
FULL_PLAN = {
    "priority": [{"id": 0, "target": "application.submitted_at", "direction": "ascending"}],
    "marketDates": [{"date": "2099-08-01"}, {"date": "2099-08-02"}],
    "tiers": [{"id": 0, "name": "Gold"}, {"id": 1, "name": "Silver"}],
    "locations": [dict(MAIN_HALL), dict(OLD_HALL)],
    "sections": [
        {"id": "sec-a", "name": "Hall A", "count": 9, "location": dict(MAIN_HALL),
         "tier": {"id": 0, "name": "Gold"}},
        {"id": "sec-old", "name": "Old Row", "count": 6, "location": dict(OLD_HALL),
         "tier": {"id": 0, "name": "Gold"}},
    ],
    "assignmentOptions": {"maxAssignmentsPerVendor": 2, "maxHalfTableProportionPerSection": 30},
    "pricing": {"currency": "CAD", "halfTablePercent": 50, "groups": [],
                "everyoneElse": [{"tier": "Gold", "cents": 3500}]},
    "tableTypes": [dict(SIX_FOOT)],
}


def _table(table_id, number, x=400, section="sec-a"):
    return {"id": table_id, "sectionId": section, "number": number, "tableTypeId": "tt-1",
            "xMm": x, "yMm": 400, "rotation": 0}


def _floorplan(floorplan_id="fp-1", location="loc-main", **overrides):
    """A layout as the editor sends it: camelCase, an 800 x 600 px floorplan at 0.1 px per mm
    (8 m across), two tables of Hall A."""
    floorplan = {
        "id": floorplan_id,
        "locationId": location,
        "revision": 1,
        "scalePxPerUnit": 0.1,
        "imageWidth": 800,
        "imageHeight": 600,
        "tables": [_table("t-1", 1), _table("t-2", 2, x=800)],
        "zones": [],
        "sectionStyles": [{"sectionId": "sec-a", "color": 1, "labelAt": None}],
        "startingCounts": [{"sectionId": "sec-a", "count": 9}],
    }
    floorplan.update(overrides)
    return floorplan


def _with_plan(market, **plan_overrides):
    market.doc["setupObject"] = {**copy.deepcopy(FULL_PLAN), **plan_overrides}


def _account(email):
    if email not in ACCOUNTS:
        return None
    return SimpleNamespace(
        id=ACCOUNTS[email], email=email, is_active=True, is_authenticated=True,
        is_anonymous=False, get_id=lambda e=email: e,
    )


@pytest.fixture
def market(monkeypatch):
    """The market every save names, a draft with no plan, as the new-market dialog leaves it; a
    test gives it a plan with ``_with_plan``."""
    markets = FakeMarketsCollection(stored_market(MarketPhase.DRAFT, roles=dict(ROLES)))
    monkeypatch.setattr(MarketsApi, "markets_collection", markets)
    monkeypatch.setattr(MarketWrite, "markets_collection", markets)
    monkeypatch.setitem(_THE_MARKET, "markets", markets)
    return markets


#: The market fixture's collection, so a save can name the revision it read by default.
_THE_MARKET: dict = {}


def _stored_revision(floorplan_id):
    """The revision the market holds of the floorplan of this id, 0 for one it does not hold: what
    an editor that just read the market sends."""
    markets = _THE_MARKET.get("markets")
    plan = (markets.doc or {}).get("setupObject") if markets else None
    for floorplan in (plan or {}).get("floorplans") or []:
        if floorplan.get("id") == floorplan_id:
            return floorplan.get("revision", 0)
    return 0


@pytest.fixture
def client(monkeypatch):
    """A client signed in as the market's editor."""
    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    sessions_load_through_get_user(monkeypatch)
    monkeypatch.setattr(UsersApi, "get_user", _account)
    return _signed_in("editor@example.com")


def _signed_in(email):
    client = app_module.app.test_client()
    with client.session_transaction() as session:
        session["_user_id"] = email
        session["_fresh"] = True
    return client


#: A save naming the revision the market holds, as an editor that read it does.
AS_STORED = object()


def _save(client, floorplan, market_id=MARKET_ID, revision=AS_STORED):
    if revision is AS_STORED:
        revision = _stored_revision(floorplan.get("id") if isinstance(floorplan, dict) else None)
    return client.post("/floorplans/save-to-market",
                       json={"market_id": market_id, "floorplan": floorplan,
                             "revision": revision})


def _saved_plan(market):
    """The market as the next reader parses it, once the recorded write has landed."""
    assert market.last_update is not None, "the save wrote nothing"
    return market_from_document(market.doc).setup_object


def _floorplan_entries(market_records):
    return [entry for entry in market_records.history.documents
            if entry.get("kind") == History.FLOORPLAN]


class TestAMarketWithNoPlan:

    def test_a_layout_is_refused_for_want_of_a_location_and_the_market_still_reads(
        self, client, market, market_records,
    ):
        response = _save(client, _floorplan())

        assert response.status_code == 400
        assert response.get_json() == {"error": Layout.UNKNOWN_LOCATION}
        assert market.last_update is None
        assert market_from_document(market.doc) is not None


class TestAMarketWithAPlan:

    def test_only_the_floorplans_and_the_laid_out_counts_change(self, client, market):
        _with_plan(market)
        before = market_from_document(market.doc).setup_object

        response = _save(client, _floorplan())

        assert response.status_code == 200, response.get_json()
        after = _saved_plan(market)
        assert after.model_dump(exclude={"sections", "floorplans"}) == before.model_dump(
            exclude={"sections", "floorplans"})
        assert [(s.id, s.name, s.count) for s in after.sections] == [
            ("sec-a", "Hall A", 2), ("sec-old", "Old Row", 6)]
        assert [floorplan.id for floorplan in after.floorplans] == ["fp-1"]

    def test_it_writes_the_whole_plan_in_one_set(self, client, market):
        _with_plan(market)

        _save(client, _floorplan())

        assert set(market.last_update["$set"]) == {"setupObject"}
        # And counts the plan's revision, as every write of the plan does (T274).
        assert market.last_update["$inc"] == {"planRevision": 1}

    def test_a_floorplan_saved_again_replaces_itself_in_place(self, client, market, market_records):
        _with_plan(market, floorplans=[_floorplan("fp-0", location="loc-old", tables=[]),
                                       _floorplan("fp-1")])

        response = _save(client, _floorplan("fp-1", tables=[_table("t-1", 1)]))

        assert response.status_code == 200, response.get_json()
        plan = _saved_plan(market)
        assert [floorplan.id for floorplan in plan.floorplans] == ["fp-0", "fp-1"]
        assert [table.id for table in plan.floorplans[1].tables] == ["t-1"]
        assert plan.sections[0].count == 1
        (entry,) = _floorplan_entries(market_records)
        assert entry["detail"] == {"removed": {"Hall A": 1}}

    def test_a_floorplan_of_a_new_id_is_added(self, client, market, market_records):
        _with_plan(market, floorplans=[_floorplan("fp-0", location="loc-old", tables=[])])

        response = _save(client, _floorplan("fp-1"))

        assert response.status_code == 200, response.get_json()
        assert [floorplan.id for floorplan in _saved_plan(market).floorplans] == ["fp-0", "fp-1"]
        (entry,) = _floorplan_entries(market_records)
        assert entry["detail"]["started"] is True

    def test_a_refusal_of_the_plans_own_writer_answers_its_own_sentence(self, client, market):
        """A rule of the plan write holds here too, and answers as the plan write does: a stored
        share out of range, from before the plan write refused one, is refused with its sentence,
        not swallowed into an "Internal server error"."""
        _with_plan(market, assignmentOptions={"maxHalfTableProportionPerSection": 150})

        response = _save(client, _floorplan())

        assert response.status_code == 400
        assert "max_half_table_proportion_per_section" in response.get_json()["error"]
        assert market.last_update is None


class TestTheLayoutsOwnRules:
    """``layout.layout_refusal``, after the parse, the bounds and the image (T257)."""

    @pytest.mark.parametrize("overrides,sentence", [
        ({"locationId": "loc-gone"}, Layout.UNKNOWN_LOCATION),
        ({"locationId": None}, Layout.UNKNOWN_LOCATION),
        ({"tables": [_table("t-1", 1), _table("t-2", 3)]}, Layout.NUMBERING),
        ({"tables": [{**_table("t-1", 1), "tableTypeId": "tt-gone"}]}, Layout.UNKNOWN_TABLE_TYPE),
        ({"tables": [_table("t-1", 1, x=8001)]}, Layout.OUTSIDE_THE_FLOORPLAN),
        ({"scalePxPerUnit": None}, Layout.NOT_CALIBRATED),
        ({"tables": [_table("t-1", 1), {**_table("x", None, x=600), "sectionId": None},
                     {**_table("x", None, x=700), "sectionId": None}]}, Layout.TABLE_IDS),
    ], ids=["unknown-location", "no-location", "numbering", "type", "outside", "no-scale",
            "one-id-twice"])
    def test_a_layout_breaking_one_is_refused_and_writes_nothing(
        self, client, market, market_records, overrides, sentence,
    ):
        _with_plan(market)

        response = _save(client, _floorplan(**overrides))

        _refused_and_unwritten(response, sentence, market, market_records)

    def test_a_floorplan_the_beta_sends_is_refused(self, client, market, market_records):
        _with_plan(market)
        beta = {"id": "fp-beta", "scaleUnit": "mm", "walls": [], "placedTables": [
            {"id": "t-1", "tableTypeId": "tt-1", "x": 40, "y": 40, "widthMm": 1800,
             "heightMm": 900}]}

        response = _save(client, beta)

        _refused_and_unwritten(response, Layout.UNKNOWN_LOCATION, market, market_records)

    def test_the_bounds_answer_before_the_layouts_rules(self, client, market, market_records):
        _with_plan(market)

        response = _save(client, _floorplan(locationId="loc-gone", tables=_tables(1001)))

        _refused_and_unwritten(response, "A floorplan holds at most 1,000 tables.", market,
                               market_records)


class TestATableOfNoSectionOfItsLocation:

    @pytest.mark.parametrize("section", ["sec-gone", "sec-old"], ids=["gone", "another-location"])
    def test_it_is_stored_in_no_section_and_of_no_number(self, client, market, section):
        _with_plan(market)

        response = _save(client, _floorplan(tables=[_table("t-1", 1),
                                                    _table("t-x", 1, x=800, section=section)]))

        assert response.status_code == 200, response.get_json()
        stored = _saved_plan(market).floorplans[0].tables
        assert [(t.id, t.section_id, t.number) for t in stored] == [
            ("t-1", "sec-a", 1), ("t-x", None, None)]


class TestTheSaveIsRecorded:
    """One ``floorplan`` entry a save, its subject the layout and its location's name, its detail
    what ``layout.describe_change`` says the save changed (T257)."""

    def test_one_floorplan_entry_and_no_plan_entry(self, client, market, market_records):
        _with_plan(market)

        _save(client, _floorplan())

        (entry,) = _floorplan_entries(market_records)
        assert entry["action"] == Actions.CHANGE_SETUP.id
        assert entry["subject"] == {"floorplan_id": "fp-1", "location": "Main Hall"}
        assert not [e for e in market_records.history.documents if e.get("kind") == History.PLAN]

    def test_a_layouts_first_save_is_its_start(self, client, market, market_records):
        _with_plan(market)

        _save(client, _floorplan())

        (entry,) = _floorplan_entries(market_records)
        assert entry["detail"] == {"started": True, "added": {"Hall A": 2}, "scale": {
            "before": None, "after": 8.0}, "colours": ["Hall A"]}

    def test_a_save_that_moved_a_table_says_so(self, client, market, market_records):
        _with_plan(market)
        _save(client, _floorplan("fp-1"))
        market_records.history.documents.clear()
        moved = _floorplan("fp-1")
        moved["tables"][0]["xMm"] = 300

        response = _save(client, moved)

        assert response.status_code == 200, response.get_json()
        (entry,) = _floorplan_entries(market_records)
        assert entry["detail"] == {"moved": 1}

    def test_a_recalibration_records_the_metres_across(self, client, market, market_records):
        _with_plan(market)
        _save(client, _floorplan("fp-1"))
        market_records.history.documents.clear()

        _save(client, _floorplan("fp-1", scalePxPerUnit=0.02))

        (entry,) = _floorplan_entries(market_records)
        assert entry["detail"]["scale"] == {"before": 8.0, "after": 40.0}

    def test_the_entry_never_carries_a_table(self, client, market, market_records):
        """An entry is fetched with the market's history, so it counts tables, never holds one."""
        _with_plan(market)
        _save(client, _floorplan("fp-1"))
        market_records.history.documents.clear()
        grown = _floorplan("fp-1", zones=_zones(3))
        grown["tables"].append(_table("t-3", 3, x=1200))

        _save(client, grown)

        (entry,) = _floorplan_entries(market_records)
        assert entry["detail"] == {"added": {"Hall A": 1},
                                   "zones": {"added": 3, "changed": 0, "removed": 0}}
        assert "t-3" not in json.dumps(entry["detail"])

    def test_a_floorplan_restated_unchanged_records_nothing(self, client, market, market_records):
        _with_plan(market)
        _save(client, _floorplan("fp-1"))
        market_records.history.documents.clear()

        response = _save(client, _floorplan("fp-1"))

        assert response.status_code == 200, response.get_json()
        assert _floorplan_entries(market_records) == []


STALE = "This layout changed elsewhere. Reload to see the latest."


def _refused_as_stale(response, market, market_records):
    assert response.status_code == 409, response.get_json()
    assert response.get_json() == {"error": STALE}
    assert _floorplan_entries(market_records) == []


def _counts_the_plans_revision(market):
    """What every writer of the plan does as it lands, a layout save, a types write or a plan
    write: count the plan's revision (T274), which a save that read before it holds."""
    market.doc["planRevision"] = (market.doc.get("planRevision") or 0) + 1


class TestARevisionGuardsEachSave:
    """A save names the revision of the layout it read, 0 for a new one; the stored one moves by
    one on every write, so a save from a tab that read an older layout is refused, never written
    over the newer one (T257)."""

    def test_a_new_layout_is_stored_at_revision_one(self, client, market):
        _with_plan(market)

        response = _save(client, _floorplan(revision=7), revision=0)

        assert response.status_code == 200, response.get_json()
        assert _saved_plan(market).floorplans[0].revision == 1
        assert response.get_json()["floorplan"]["revision"] == 1

    def test_each_save_moves_it_by_one(self, client, market):
        _with_plan(market)
        _save(client, _floorplan(), revision=0)

        response = _save(client, _floorplan(), revision=1)

        assert response.status_code == 200, response.get_json()
        assert _saved_plan(market).floorplans[0].revision == 2

    def test_a_save_naming_an_older_revision_is_refused(self, client, market, market_records):
        _with_plan(market)
        _save(client, _floorplan(), revision=0)
        _save(client, _floorplan(), revision=1)
        market_records.history.documents.clear()
        written = copy.deepcopy(market.doc)

        response = _save(client, _floorplan(tables=[]), revision=1)

        _refused_as_stale(response, market, market_records)
        assert market.doc == written

    def test_a_save_of_a_layout_the_market_does_not_hold_naming_a_revision_is_refused(
        self, client, market, market_records,
    ):
        """It was read, and is gone: the tab is stale, and saving would start it again."""
        _with_plan(market)

        response = _save(client, _floorplan(), revision=3)

        _refused_as_stale(response, market, market_records)
        assert market.last_update is None

    def test_a_save_that_lands_after_another_between_its_read_and_its_write_is_refused(
        self, client, market, market_records, monkeypatch,
    ):
        """The plan's revision is held by the write itself, so two saves read together cannot both
        land."""
        _with_plan(market, floorplans=[_floorplan(revision=4)])
        read = MarketsApi.load_market_context

        def read_then_another_save_lands(market_id):
            context = read(market_id)
            market.doc["setupObject"]["floorplans"][0]["revision"] = 5
            _counts_the_plans_revision(market)
            return context

        monkeypatch.setattr(MarketsApi, "load_market_context", read_then_another_save_lands)

        response = _save(client, _floorplan(tables=[]), revision=4)

        _refused_as_stale(response, market, market_records)
        assert [t["id"] for t in market.doc["setupObject"]["floorplans"][0]["tables"]] == [
            "t-1", "t-2"]

    @pytest.mark.parametrize("revision", [None, "1", True, -1, 1.5])
    def test_a_save_with_no_revision_is_refused(self, client, market, revision):
        _with_plan(market)

        response = _save(client, _floorplan(), revision=revision)

        assert response.status_code == 400
        assert response.get_json() == {"error": "revision is required"}
        assert market.last_update is None


class TestTypesWrittenBetweenTheReadAndTheWrite:
    """A layout's save writes the plan whole, the table types with it: types written by their own
    write between its read and its write count the plan's revision, which the save holds, so they
    refuse it rather than being put back (review of ticket 10, T274)."""

    def test_the_save_is_refused_and_the_types_kept(self, client, market, market_records,
                                                     monkeypatch):
        _with_plan(market, floorplans=[_floorplan(revision=1)])
        read = market.find_one
        landed = []

        def read_then_types_land(query, projection=None):
            found = read(query, projection)
            if landed:
                return found
            landed.append(True)
            market.doc["setupObject"]["tableTypes"].append(
                {"id": "tt-2", "name": "Square 4 ft", "widthMm": 1220, "depthMm": 1220})
            _counts_the_plans_revision(market)
            return found

        monkeypatch.setattr(market, "find_one", read_then_types_land)

        response = _save(client, _floorplan(revision=1), revision=1)

        assert response.status_code == 409
        assert [t["id"] for t in market.doc["setupObject"]["tableTypes"]] == ["tt-1", "tt-2"]


class TestALocationHasOneLayout:

    def test_a_second_layout_for_a_location_is_refused(self, client, market, market_records):
        """Two tabs that each started the same hall's layout: the second is the stale one."""
        _with_plan(market, floorplans=[_floorplan("fp-1")])

        response = _save(client, _floorplan("fp-2"), revision=0)

        _refused_as_stale(response, market, market_records)
        assert market.last_update is None

    def test_a_second_layout_landing_between_the_read_and_the_write_is_refused(
        self, client, market, market_records, monkeypatch,
    ):
        _with_plan(market)
        read = MarketsApi.load_market_context

        def read_then_another_start_lands(market_id):
            context = read(market_id)
            market.doc["setupObject"]["floorplans"] = [_floorplan("fp-other")]
            _counts_the_plans_revision(market)
            return context

        monkeypatch.setattr(MarketsApi, "load_market_context", read_then_another_start_lands)

        response = _save(client, _floorplan("fp-2"), revision=0)

        _refused_as_stale(response, market, market_records)
        assert [f["id"] for f in market.doc["setupObject"]["floorplans"]] == ["fp-other"]

    def test_a_save_never_moves_a_layout_to_another_location(self, client, market):
        _with_plan(market, floorplans=[_floorplan("fp-1", tables=[])])

        response = _save(client, _floorplan("fp-1", location="loc-old", tables=[]))

        assert response.status_code == 200, response.get_json()
        assert _saved_plan(market).floorplans[0].location_id == "loc-main"


STANDARD = {"name": "Standard 6 ft", "width_mm": 1830, "depth_mm": 760}


class TestALayoutsStart:
    """The first save of a location's layout gives a market with no table type "Standard 6 ft", and
    records what Section Setup had for each of the location's sections (T257)."""

    def test_a_market_with_no_type_gains_the_standard_one(self, client, market):
        _with_plan(market, tableTypes=[])

        response = _save(client, _floorplan(tables=[]))

        assert response.status_code == 200, response.get_json()
        (table_type,) = _saved_plan(market).table_types
        assert table_type.model_dump(exclude={"id"}) == STANDARD
        assert table_type.id

    def test_a_market_with_types_keeps_them(self, client, market):
        _with_plan(market)

        _save(client, _floorplan(tables=[]))

        assert [t.id for t in _saved_plan(market).table_types] == ["tt-1"]

    def test_a_later_save_adds_no_type(self, client, market):
        _with_plan(market, tableTypes=[], floorplans=[_floorplan(tables=[])])

        response = _save(client, _floorplan(tables=[]))

        assert response.status_code == 200, response.get_json()
        assert _saved_plan(market).table_types == []

    def test_the_starting_counts_are_section_setups_for_the_location(self, client, market):
        _with_plan(market)

        _save(client, _floorplan(startingCounts=[{"sectionId": "sec-old", "count": 40}]))

        (floorplan,) = _saved_plan(market).floorplans
        assert [(c.section_id, c.count) for c in floorplan.starting_counts] == [("sec-a", 9)]

    def test_a_location_of_more_sections_than_a_layout_counts_is_refused(
        self, client, market, market_records,
    ):
        """The starting counts the save records are held to their bound like any list of it."""
        many = [{"id": f"sec-{i}", "name": f"Row {i}", "count": 1, "location": dict(MAIN_HALL),
                 "tier": {"id": 0, "name": "Gold"}} for i in range(201)]
        _with_plan(market, sections=many)

        response = _save(client, _floorplan(tables=[], sectionStyles=[]))

        _refused_and_unwritten(response, "A floorplan holds at most 200 starting counts.",
                               market, market_records)

    def test_a_later_save_keeps_the_starting_counts_it_began_with(self, client, market):
        _with_plan(market)
        _save(client, _floorplan())

        _save(client, _floorplan(startingCounts=[]))

        (floorplan,) = _saved_plan(market).floorplans
        assert [(c.section_id, c.count) for c in floorplan.starting_counts] == [("sec-a", 9)]


class TestTheAnswer:

    def test_it_is_the_layout_as_stored_and_the_sections_counting_it(self, client, market):
        _with_plan(market)

        response = _save(client, _floorplan())

        assert response.status_code == 200
        body = response.get_json()
        assert set(body) == {"floorplan", "sections"}
        stored = market.doc["setupObject"]
        assert body["floorplan"] == stored["floorplans"][0]
        assert body["sections"] == stored["sections"]
        assert [(s["id"], s["count"]) for s in body["sections"]] == [("sec-a", 2), ("sec-old", 6)]


class TestAReplacedImage:

    def test_the_image_it_replaced_is_deleted(self, client, market, market_records):
        _with_plan(market)
        first = str(market_records.images.put(b"png", metadata={"marketId": MARKET_ID}))
        second = str(market_records.images.put(b"png", metadata={"marketId": MARKET_ID}))
        _save(client, _floorplan(imageGridfsId=first))
        market_records.history.documents.clear()

        response = _save(client, _floorplan(imageGridfsId=second))

        assert response.status_code == 200, response.get_json()
        from bson import ObjectId
        assert ObjectId(first) not in market_records.images.files
        assert ObjectId(second) in market_records.images.files
        (entry,) = _floorplan_entries(market_records)
        assert entry["detail"] == {"image": "replaced"}

    def test_a_refused_save_deletes_no_image(self, client, market, market_records):
        _with_plan(market)
        first = str(market_records.images.put(b"png", metadata={"marketId": MARKET_ID}))
        second = str(market_records.images.put(b"png", metadata={"marketId": MARKET_ID}))
        _save(client, _floorplan(imageGridfsId=first))

        response = _save(client, _floorplan(imageGridfsId=second), revision=0)

        assert response.status_code == 409
        from bson import ObjectId
        assert ObjectId(first) in market_records.images.files


class TestAFloorplanThatDoesNotParse:

    @pytest.mark.parametrize("field,value", [
        ("zones", "not-a-list-7731"),
        ("sectionStyles", ["not-a-style-7731"]),
        ("tables", [{"id": "t-1", "xMm": "not-a-number-7731"}]),
        ("scalePxPerUnit", "not-a-number-7731"),
    ])
    def test_it_is_refused_naming_the_field_and_writes_nothing(
        self, client, market, market_records, caplog, field, value,
    ):
        _with_plan(market)

        response = _save(client, _floorplan(**{field: value}))

        assert response.status_code == 400
        error = response.get_json()["error"]
        assert error.startswith("Invalid floorplan")
        assert field.lower().replace("_", "") in error.lower().replace("_", "")
        assert "7731" not in error
        assert "7731" not in caplog.text
        assert market.last_update is None
        assert _floorplan_entries(market_records) == []

    @pytest.mark.parametrize("floorplan_id", [None, "", "   "])
    def test_a_floorplan_with_no_id_is_refused(self, client, market, floorplan_id):
        floorplan = _floorplan()
        if floorplan_id is None:
            del floorplan["id"]
        else:
            floorplan["id"] = floorplan_id

        response = _save(client, floorplan)

        assert response.status_code == 400
        assert response.get_json() == {"error": "A floorplan needs its id."}
        assert market.last_update is None

    def test_unknown_keys_are_not_stored(self, client, market):
        _with_plan(market)
        junk = "x" * 100_000
        floorplan = _floorplan(junk=junk, walls=[{"id": "w-1"}])
        floorplan["tables"][0]["extra"] = junk

        response = _save(client, floorplan)

        assert response.status_code == 200, response.get_json()
        assert "xxxxxxxxxx" not in json.dumps(market.last_update)
        stored = market.last_update["$set"]["setupObject"]["floorplans"][0]
        assert "junk" not in stored and "walls" not in stored
        assert "extra" not in stored["tables"][0]


class TestTheAnswersBeforeTheParseKeepTheirOrder:

    def test_a_body_that_is_not_an_object_is_refused(self, client, market):
        response = client.post("/floorplans/save-to-market",
                               json=[{"market_id": MARKET_ID, "floorplan": _floorplan()}])

        assert response.status_code == 400
        assert response.get_json() == {"error": NOT_AN_OBJECT}

    def test_a_body_naming_no_market_is_refused(self, client, market):
        response = client.post("/floorplans/save-to-market", json={"floorplan": _floorplan()})

        assert response.status_code == 400
        assert response.get_json() == {"error": "market_id is required"}

    @pytest.mark.parametrize("floorplan", [None, [_floorplan()], "a floorplan", 7])
    def test_a_floorplan_that_is_not_an_object_is_refused(self, client, market, floorplan):
        body = {"market_id": MARKET_ID}
        if floorplan is not None:
            body["floorplan"] = floorplan

        response = client.post("/floorplans/save-to-market", json=body)

        assert response.status_code == 400
        assert response.get_json() == {"error": "floorplan is required"}
        assert market.last_update is None

    def test_an_unknown_market_is_not_found(self, client, market):
        response = _save(client, _floorplan(), market_id="no-such-market")

        assert response.status_code == 404

    def test_a_market_that_does_not_parse_is_refused_as_invalid(self, client, market):
        # What the save used to leave behind: a plan of sections, locations and floorplans alone.
        market.doc["setupObject"] = {"sections": [], "locations": [], "floorplans": []}

        response = _save(client, _floorplan())

        assert response.status_code == 400
        assert response.get_json() == {"error": "Invalid market data"}

    def test_a_save_without_a_session_is_asked_to_sign_in(self, client, market):
        response = app_module.app.test_client().post(
            "/floorplans/save-to-market",
            json={"market_id": MARKET_ID, "floorplan": _floorplan(), "revision": 0})

        assert response.status_code == 401
        assert market.last_update is None

    def test_an_account_with_no_role_on_the_market_is_refused(self, client, market):
        _with_plan(market)

        response = _save(_signed_in("outsider@example.com"), _floorplan())

        assert response.status_code == 403
        assert response.get_json() == {"error": Actions.refusal_sentence(Actions.CHANGE_SETUP)}
        assert market.last_update is None

    def test_a_viewer_is_refused_before_the_floorplan_is_read(self, client, market):
        response = _save(_signed_in("viewer@example.com"), _floorplan(tables="not a list"))

        assert response.status_code == 403
        assert response.get_json() == {"error": Actions.refusal_sentence(Actions.CHANGE_SETUP)}
        assert market.last_update is None

    def test_an_archived_market_is_refused_before_the_floorplan_is_read(self, client, market):
        market.doc = stored_market(MarketPhase.ARCHIVED, roles=dict(ROLES))

        response = _save(client, _floorplan(tables="not a list"))

        assert response.status_code == 403
        assert response.get_json() == {"error": MarketsApi.ARCHIVED_REFUSAL}
        assert market.last_update is None

    def test_a_settled_setup_reads_the_floorplan_before_it_judges_the_seats(self, client, market):
        """Past draft a table may still move (T257), so the save parses the floorplan to tell a
        move from a seat changed: one that does not parse is refused as such, not as settled."""
        market.doc = stored_market(MarketPhase.APPLICATIONS, roles=dict(ROLES),
                                   setupObject=copy.deepcopy(FULL_PLAN))

        response = _save(client, _floorplan(tables="not a list"))

        assert response.status_code == 400
        assert "tables" in response.get_json()["error"]
        assert market.last_update is None


# ── The bounds (ticket 03) ────────────────────────────────────────────────────

OVER = "over"
AT = "at"


def _zones(n):
    return [{"id": f"z-{i}", "label": "Stage", "xMm": 0, "yMm": i, "widthMm": 100,
             "depthMm": 100} for i in range(n)]


def _tables(n):
    """``n`` tables of no section, which the numbering asks nothing of."""
    return [{"id": f"t-{i}", "sectionId": None, "number": None, "tableTypeId": "tt-1",
             "xMm": i % 8000, "yMm": 0} for i in range(n)]


def _styles(n):
    return [{"sectionId": f"sec-{i}", "color": 1 + i % 8} for i in range(n)]


#: Each list bound: the overrides holding ``n`` of the thing, the bound, and its sentence.
LIST_BOUNDS = [
    (lambda n: {"tables": _tables(n)}, 1000, "A floorplan holds at most 1,000 tables."),
    (lambda n: {"zones": _zones(n)}, 100, "A floorplan holds at most 100 no-table zones."),
    (lambda n: {"sectionStyles": _styles(n)}, 200,
     "A floorplan holds at most 200 section styles."),
]
LIST_BOUND_IDS = ["tables", "zones", "section-styles"]

MEASUREMENT = "A floorplan's measurements must be finite numbers no larger than 10,000,000."
TEXT = "A floorplan's names and ids are at most 200 characters."
UNTIED = "The floorplan's image was not uploaded for this market."


def _save_raw(client, text):
    """A save sent as the text given, since a JSON library will not write ``NaN``."""
    return client.post("/floorplans/save-to-market", data=text,
                       headers={"Content-Type": "application/json"})


def _with_token(floorplan, token):
    """The save body as JSON text, with every ``"@@"`` in ``floorplan`` written as ``token``."""
    return json.dumps({"market_id": MARKET_ID, "floorplan": floorplan, "revision": 0}).replace(
        '"@@"', token)


def _refused_and_unwritten(response, sentence, market, market_records):
    assert response.status_code == 400, response.get_json()
    assert response.get_json() == {"error": sentence}
    assert market.last_update is None
    assert _floorplan_entries(market_records) == []


class TestAFloorplanIsHeldToItsListBounds:

    @pytest.mark.parametrize("build,bound,sentence", LIST_BOUNDS, ids=LIST_BOUND_IDS)
    def test_one_over_the_bound_is_refused_and_writes_nothing(
        self, client, market, market_records, build, bound, sentence,
    ):
        _with_plan(market)

        response = _save(client, _floorplan(**build(bound + 1)))

        _refused_and_unwritten(response, sentence, market, market_records)

    @pytest.mark.parametrize("build,bound,sentence", LIST_BOUNDS, ids=LIST_BOUND_IDS)
    def test_exactly_at_the_bound_saves(self, client, market, build, bound, sentence):
        _with_plan(market)

        response = _save(client, _floorplan(**build(bound)))

        assert response.status_code == 200, response.get_json()
        assert _saved_plan(market).floorplans[0].id == "fp-1"


class TestAFloorplansTextIsBounded:

    @pytest.mark.parametrize("place", ["id", "zone-label", "table-id", "style-section"])
    def test_a_string_over_200_characters_anywhere_is_refused(
        self, client, market, market_records, place,
    ):
        _with_plan(market)
        long = "a" * 201
        floorplan = _floorplan(zones=_zones(1))
        if place == "zone-label":
            floorplan["zones"][0]["label"] = long
        elif place == "table-id":
            floorplan["tables"][0]["id"] = long
        elif place == "style-section":
            floorplan["sectionStyles"][0]["sectionId"] = long
        else:
            floorplan[place] = long

        _refused_and_unwritten(_save(client, floorplan), TEXT, market, market_records)

    def test_a_string_of_200_characters_saves(self, client, market):
        _with_plan(market)
        floorplan = _floorplan(floorplan_id="a" * 200, zones=_zones(1))
        floorplan["zones"][0]["label"] = "b" * 200

        response = _save(client, floorplan)

        assert response.status_code == 200, response.get_json()


class TestAFloorplansMeasurementsAreFinite:

    @pytest.mark.parametrize("token", ["NaN", "Infinity", "-Infinity"])
    @pytest.mark.parametrize("place", ["scalePxPerUnit", "label-at", "table-x", "zone-width",
                                       "reference-line"])
    def test_a_number_that_is_not_finite_is_refused_and_the_market_still_reads(
        self, client, market, market_records, token, place,
    ):
        _with_plan(market)
        floorplan = _floorplan(zones=_zones(1))
        if place == "label-at":
            floorplan["sectionStyles"][0]["labelAt"] = {"xMm": "@@", "yMm": 0}
        elif place == "table-x":
            floorplan["tables"][0]["xMm"] = "@@"
        elif place == "zone-width":
            floorplan["zones"][0]["widthMm"] = "@@"
        elif place == "reference-line":
            floorplan["referenceLineEnd"] = [10, "@@"]
        else:
            floorplan[place] = "@@"

        response = _save_raw(client, _with_token(floorplan, token))

        _refused_and_unwritten(response, MEASUREMENT, market, market_records)

    @pytest.mark.parametrize("value", [10_000_001, -10_000_001, 1e300])
    def test_a_number_past_ten_million_is_refused(self, client, market, market_records, value):
        _with_plan(market)
        floorplan = _floorplan(zones=_zones(1))
        floorplan["zones"][0]["widthMm"] = value

        _refused_and_unwritten(_save(client, floorplan), MEASUREMENT, market, market_records)

    def test_ten_million_saves(self, client, market):
        _with_plan(market)
        floorplan = _floorplan(imageWidth=10_000_000, zones=_zones(1))
        floorplan["zones"][0]["yMm"] = -10_000_000

        response = _save(client, floorplan)

        assert response.status_code == 200, response.get_json()


class TestAFloorplanNamesOnlyItsMarketsImage:

    def test_its_own_markets_image_saves(self, client, market, market_records):
        _with_plan(market)
        gridfs_id = str(market_records.images.put(b"png", metadata={"marketId": MARKET_ID}))

        response = _save(client, _floorplan(imageGridfsId=gridfs_id))

        assert response.status_code == 200, response.get_json()
        assert _saved_plan(market).floorplans[0].image_gridfs_id == gridfs_id

    @pytest.mark.parametrize("image", ["another-market", "no-market", "unknown", "not-an-id"])
    def test_any_other_image_is_refused(self, client, market, market_records, image):
        from bson import ObjectId

        _with_plan(market)
        if image == "another-market":
            gridfs_id = str(market_records.images.put(b"png", metadata={"marketId": "market-9"}))
        elif image == "no-market":
            gridfs_id = str(market_records.images.put(b"png", metadata=None))
        elif image == "unknown":
            gridfs_id = str(ObjectId())
        else:
            gridfs_id = "not-an-id"

        response = _save(client, _floorplan(imageGridfsId=gridfs_id))

        _refused_and_unwritten(response, UNTIED, market, market_records)


def _halls(n):
    """``n`` locations, ``hall-0`` to ``hall-<n-1>``, for a layout each."""
    return [{"id": f"hall-{i}", "name": f"Hall {i}"} for i in range(n)]


def _layouts(n):
    return [_floorplan(f"fp-{i}", location=f"hall-{i}", tables=[]) for i in range(n)]


class TestAMarketKeepsAtMostTwentyFloorplans:

    def test_a_twenty_first_is_refused(self, client, market, market_records):
        _with_plan(market, locations=[*_halls(20), dict(MAIN_HALL)], floorplans=_layouts(20))

        response = _save(client, _floorplan("fp-new"))

        _refused_and_unwritten(response, "A market keeps at most 20 floorplans.", market,
                               market_records)

    def test_replacing_one_of_twenty_saves(self, client, market):
        _with_plan(market, locations=_halls(20), floorplans=_layouts(20))

        response = _save(client, _floorplan("fp-7", location="hall-7", tables=[],
                                            zones=_zones(2)))

        assert response.status_code == 200, response.get_json()
        floorplans = _saved_plan(market).floorplans
        assert len(floorplans) == 20
        assert len(floorplans[7].zones) == 2

    def test_a_market_already_over_twenty_may_still_replace_its_own(self, client, market):
        """The save once added a copy on every save, so a market may hold more than 20 already;
        the count refuses only a list that grows past the bound."""
        _with_plan(market, locations=[*_halls(23), dict(MAIN_HALL)], floorplans=_layouts(23))

        assert _save(client, _floorplan("fp-3", location="hall-3", tables=[])).status_code == 200
        assert _save(client, _floorplan("fp-new")).get_json() == {
            "error": "A market keeps at most 20 floorplans."}


class TestThePlanWriteNeverJudgesFloorplans:
    """``PUT /markets/:id/plan`` keeps the stored floorplans whatever its body carries (T257), so
    it neither stores nor refuses the body's."""

    def _put_plan(self, client, floorplans):
        return client.put(f"/markets/{MARKET_ID}/plan",
                          json={"planRevision": 0, "setupObject": {**copy.deepcopy(FULL_PLAN),
                                                "floorplans": floorplans}})

    def test_a_floorplan_over_a_bound_in_the_body_is_not_stored(self, client, market):
        _with_plan(market, floorplans=[_floorplan()])

        response = self._put_plan(client, [_floorplan(tables=_tables(1001))])

        assert response.status_code == 200, response.get_json()
        assert len(_saved_plan(market).floorplans[0].tables) == 2

    def test_a_floorplan_holding_nan_in_the_body_is_not_stored(self, client, market):
        _with_plan(market)
        body = {"planRevision": 0, "setupObject": {**copy.deepcopy(FULL_PLAN),
                                "floorplans": [_floorplan(scalePxPerUnit="@@")]}}

        response = client.put(f"/markets/{MARKET_ID}/plan",
                              data=json.dumps(body).replace('"@@"', "NaN"),
                              headers={"Content-Type": "application/json"})

        assert response.status_code == 200, response.get_json()
        assert _saved_plan(market).floorplans is None

    def test_stored_floorplans_over_the_bounds_save_with_the_plan(self, client, market):
        """A market stored before the bounds keeps saving its plan: it is never judged on them."""
        over = [_floorplan(f"fp-{i}", tables=_tables(1001), imageGridfsId="old-image")
                for i in range(22)]
        _with_plan(market, floorplans=over)

        response = self._put_plan(client, [])

        assert response.status_code == 200, response.get_json()
        assert len(_saved_plan(market).floorplans) == 22


class TestTheBoundsModule:
    """The one statement of the bounds, at the values the spec gives (T257 extends it)."""

    def test_the_bounds(self):
        import floorplan_limits as Limits

        assert (Limits.MAX_FLOORPLANS_PER_MARKET, Limits.MAX_WALLS, Limits.MAX_OBSTACLES,
                Limits.MAX_POLYGON_POINTS, Limits.MAX_TABLE_TYPES, Limits.MAX_PLACED_TABLES,
                Limits.MAX_SECTIONS, Limits.MAX_TEXT_LENGTH, Limits.MAX_MAGNITUDE,
                Limits.MAX_UPLOAD_BYTES, Limits.MAX_PDF_PAGES) == (
            20, 100, 100, 100, 50, 1000, 200, 200, 10_000_000, 4_000_000, 20)
        assert Limits.UPLOAD_TOO_LARGE == "This file is larger than 4 MB."
        assert Limits.TOO_MANY_PDF_PAGES == (
            "This PDF has more than 20 pages. Send the page with the plan on it.")

    def test_a_floorplan_within_every_bound_is_not_refused(self):
        import floorplan_limits as Limits
        from assignment.utils import convert_keys_to_snake_case
        from datatypes import FloorplanObject

        floorplan = FloorplanObject.model_validate(convert_keys_to_snake_case(_floorplan()))

        assert Limits.floorplan_refusal(floorplan) is None
        assert Limits.floorplans_refusal([floorplan], []) is None


# ── A layout after draft (T257 ticket 11) ─────────────────────────────────────

#: Every phase a market has left draft for and may still change in.
AFTER_DRAFT = [p for p in MarketPhase if p not in (MarketPhase.DRAFT, MarketPhase.ARCHIVED)]

SQUARE = {"id": "tt-2", "name": "Square 4 ft", "widthMm": 1220, "depthMm": 1220}
HALL_B = {"id": "sec-b", "name": "Hall B", "count": 0, "location": dict(MAIN_HALL),
          "tier": {"id": 1, "name": "Silver"}}


def _settled_market(market, phase=MarketPhase.APPLICATIONS, **plan_overrides):
    """A market past draft whose plan holds Main Hall's layout as a draft left it: ``fp-1`` at
    revision 1, its two tables of Hall A the section's count, a second section in Main Hall with
    none, and two table types, with a stored assignment beside it."""
    plan = copy.deepcopy(FULL_PLAN)
    plan["sections"][0]["count"] = 2
    plan["sections"].append(copy.deepcopy(HALL_B))
    plan["tableTypes"] = [dict(SIX_FOOT), dict(SQUARE)]
    plan["floorplans"] = [_floorplan("fp-1")]
    plan.update(plan_overrides)
    market.doc = stored_market(
        phase, roles=dict(ROLES), setupObject=plan,
        assignmentObject={"vendorAssignments": [
            {"email": "alice@example.com", "date": "2099-08-01", "tableCode": "Hall A 1",
             "tableChoice": "Full Table", "section": "Hall A", "tier": "Gold",
             "location": "Main Hall"}],
            "assignmentStatistics": None})
    return market


def _settled_sentence(market):
    return MarketsApi.setup_lock_reason(market_from_document(market.doc))


def _moved(floorplan):
    floorplan["tables"][0]["xMm"] = 1500
    floorplan["tables"][1]["rotation"] = 90
    return floorplan


class TestALayoutAfterDraft:
    """Past draft, until the market is archived, where a table stands still changes: its place and
    its turn, the no-table zones, the image, the scale, the sections' colours and labels. What would
    move a seat does not: a table added, removed or of another id, another number, section or type,
    or a layout started (``layout.settled_layout_refusal``), refused 409 with the setup-settled
    sentence and nothing written."""

    @pytest.mark.parametrize("phase", AFTER_DRAFT)
    def test_a_table_moved_and_turned_saves(self, client, market, market_records, phase):
        _settled_market(market, phase)

        response = _save(client, _moved(_floorplan("fp-1")))

        assert response.status_code == 200, response.get_json()
        (floorplan,) = _saved_plan(market).floorplans
        assert (floorplan.tables[0].x_mm, floorplan.tables[1].rotation) == (1500, 90)
        assert floorplan.revision == 2
        assert [(s.id, s.count) for s in _saved_plan(market).sections] == [
            ("sec-a", 2), ("sec-old", 6), ("sec-b", 0)]
        (entry,) = _floorplan_entries(market_records)
        assert entry["detail"] == {"moved": 1, "turned": 1}

    def test_the_write_leaves_the_assignment_alone(self, client, market):
        _settled_market(market, MarketPhase.MARKET_DAYS)
        assignment = copy.deepcopy(market.doc["assignmentObject"])

        _save(client, _moved(_floorplan("fp-1")))

        assert set(market.last_update["$set"]) == {"setupObject"}
        assert market.doc["assignmentObject"] == assignment

    @pytest.mark.parametrize("change", [
        {"zones": [{"id": "z-1", "label": "Stage", "xMm": 0, "yMm": 0, "widthMm": 2000,
                    "depthMm": 1000}]},
        {"sectionStyles": [{"sectionId": "sec-a", "color": 4, "labelAt": {"xMm": 10, "yMm": 20}}]},
        {"scalePxPerUnit": 0.05, "referenceLineLengthMm": 4000},
    ], ids=["zones", "colours and labels", "scale"])
    def test_the_rest_of_where_a_table_stands_saves(self, client, market, change):
        _settled_market(market)

        response = _save(client, _floorplan("fp-1", **change))

        assert response.status_code == 200, response.get_json()

    def test_the_image_is_replaced(self, client, market, market_records):
        _settled_market(market)
        image = str(market_records.images.put(b"png", metadata={"marketId": MARKET_ID}))

        response = _save(client, _floorplan("fp-1", imageGridfsId=image))

        assert response.status_code == 200, response.get_json()
        assert _saved_plan(market).floorplans[0].image_gridfs_id == image

    @pytest.mark.parametrize("seat", [
        "added", "removed", "renumbered", "another section", "no section", "another type",
        "another id",
    ])
    def test_a_seat_changed_is_refused_as_settled(self, client, market, market_records, seat):
        _settled_market(market)
        floorplan = _floorplan("fp-1")
        tables = floorplan["tables"]
        if seat == "added":
            tables.append(_table("t-3", 3, x=1200))
        elif seat == "removed":
            tables.pop()
        elif seat == "renumbered":
            tables[0]["number"], tables[1]["number"] = 2, 1
        elif seat == "another section":
            tables[1].update(sectionId="sec-b", number=1)
        elif seat == "no section":
            tables[1].update(sectionId=None, number=None)
        elif seat == "another type":
            tables[1]["tableTypeId"] = "tt-2"
        else:
            tables[1]["id"] = "t-9"

        response = _save(client, floorplan)

        assert response.status_code == 409, response.get_json()
        assert response.get_json() == {"error": _settled_sentence(market)}
        assert "settled" in response.get_json()["error"]
        assert market.last_update is None
        assert _floorplan_entries(market_records) == []

    def test_a_layout_is_not_started(self, client, market, market_records):
        _settled_market(market)

        response = _save(client, _floorplan("fp-2", location="loc-old", tables=[]), revision=0)

        assert response.status_code == 409, response.get_json()
        assert response.get_json() == {"error": _settled_sentence(market)}
        assert market.last_update is None

    def test_a_layout_read_before_another_save_is_stale_before_it_is_judged(self, client, market):
        _settled_market(market)
        floorplan = _floorplan("fp-1")
        floorplan["tables"].pop()

        response = _save(client, floorplan, revision=0)

        assert response.status_code == 409
        assert response.get_json() == {"error": STALE}

    def test_an_archived_market_is_refused_as_archived(self, client, market):
        _settled_market(market, MarketPhase.ARCHIVED)

        response = _save(client, _moved(_floorplan("fp-1")))

        assert response.status_code == 403
        assert response.get_json() == {"error": MarketsApi.ARCHIVED_REFUSAL}
        assert market.last_update is None

    def test_a_viewer_is_refused(self, client, market):
        _settled_market(market)

        response = _save(_signed_in("viewer@example.com"), _moved(_floorplan("fp-1")))

        assert response.status_code == 403
        assert market.last_update is None
