"""The plan holds layouts (T257 ticket 01), as Market Setup's plan write meets them.

Every section and location carries a stable id; the plan write keeps the stored layouts and table
types whatever its body carries, so Market Setup's autosave never erases a layout saved in between;
a laid-out location's sections count its tables; a location removed takes its layout and the
layout's image; and a floorplan the beta saved, of no location, reads and is ignored.
"""
import copy
import re
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
import api.markets as MarketsApi
import api.users as UsersApi
import history as History
from datatypes import MarketPhase, SetupObject
from market_documents import market_from_document

MARKET_ID = "market-123"
OWNER = "owner@example.com"
ACCOUNTS = {OWNER: "user-owner"}
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

UPPER = {"id": "loc-upper", "name": "Upper Hall"}
LOWER = {"id": "loc-lower", "name": "Lower Hall"}
SIX_FOOT = {"id": "tt-six", "name": "Standard 6 ft", "widthMm": 1830, "depthMm": 760}


def _plan(**overrides):
    """A plan as Market Setup stores it, with ids: Gold row in Upper Hall, Blue row in Lower Hall."""
    plan = {
        "priority": [], "marketDates": [{"date": "2099-08-01"}],
        "tiers": [{"id": 0, "name": "Gold"}],
        "locations": [copy.deepcopy(UPPER), copy.deepcopy(LOWER)],
        "sections": [
            {"id": "sec-gold", "name": "Gold row", "count": 13, "location": copy.deepcopy(UPPER),
             "tier": {"id": 0, "name": "Gold"}},
            {"id": "sec-blue", "name": "Blue row", "count": 7, "location": copy.deepcopy(LOWER),
             "tier": {"id": 0, "name": "Gold"}},
        ],
        "assignmentOptions": {},
    }
    plan.update(overrides)
    return plan


def _table(table_id, number, section="sec-gold", x=1000.0):
    return {"id": table_id, "sectionId": section, "number": number, "tableTypeId": "tt-six",
            "xMm": x, "yMm": 1000.0, "rotation": 0.0}


def _layout(tables=3, location="loc-upper", floorplan_id="fp-upper", image="img-upper"):
    """A stored layout: a calibrated floorplan 30 m across holding ``tables`` Gold row tables."""
    return {
        "id": floorplan_id, "locationId": location, "revision": 2, "imageGridfsId": image,
        "imageWidth": 800, "imageHeight": 600, "scalePxPerUnit": 800 / 30_000,
        "tables": [_table(f"g-{i}", i, x=1000.0 * i) for i in range(1, tables + 1)],
        "zones": [], "sectionStyles": [], "startingCounts": [],
    }


#: A floorplan as the beta's wizard saved it: no location, and the beta's own fields.
BETA_FLOORPLAN = {
    "id": "fp-beta", "imageGridfsId": "img-beta", "scalePxPerUnit": 0.1, "scaleUnit": "mm",
    "tableTypes": [{"id": "tt-1", "name": "6ft Table", "widthMm": 1800, "heightMm": 900,
                    "maxCapacity": 2}],
    "walls": [{"id": "w-1", "start": [0, 0], "end": [400, 0], "thicknessMm": 200}],
    "obstacles": [{"id": "z", "polygon": [[0, 0], [1, 1], [2, 0]], "type": "pillar"}],
    "placedTables": [{"id": "t-1", "tableTypeId": "tt-1", "x": 40, "y": 40, "widthMm": 1800,
                      "heightMm": 900}],
    "sections": [{"id": "s-1", "name": "Gold row", "locationName": "Upper Hall",
                  "tableIds": ["t-1"]}],
}


def _account(email):
    if email not in ACCOUNTS:
        return None
    return SimpleNamespace(
        id=ACCOUNTS[email], email=email, is_active=True, is_authenticated=True,
        is_anonymous=False, get_id=lambda e=email: e,
    )


@pytest.fixture
def market(monkeypatch):
    markets = FakeMarketsCollection(stored_market(MarketPhase.DRAFT, roles={"user-owner": "owner"}))
    monkeypatch.setattr(MarketsApi, "markets_collection", markets)
    return markets


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    sessions_load_through_get_user(monkeypatch)
    monkeypatch.setattr(UsersApi, "get_user", _account)
    client = app_module.app.test_client()
    with client.session_transaction() as session:
        session["_user_id"] = OWNER
        session["_fresh"] = True
    return client


def _put(client, plan):
    return client.put(f"/markets/{MARKET_ID}/plan", json={"setupObject": plan})


def _stored(market):
    """The plan as stored, camelCase, as the next reader finds it."""
    return market.doc["setupObject"]


def _read(market):
    return market_from_document(market.doc).setup_object


def _entries(market_records, kind):
    return [entry for entry in market_records.history.documents if entry.get("kind") == kind]


def _without_ids(plan):
    plan = copy.deepcopy(plan)
    for location in plan["locations"]:
        location.pop("id")
    for section in plan["sections"]:
        section.pop("id")
        section["location"].pop("id")
    return plan


class TestEverySectionAndLocationHasAnId:

    def test_a_write_without_ids_stores_a_uuid_on_every_section_and_location(self, client, market):
        response = _put(client, _without_ids(_plan()))

        assert response.status_code == 200, response.get_json()
        stored = _stored(market)
        ids = [row["id"] for row in (*stored["locations"], *stored["sections"])]
        assert all(UUID.match(row_id) for row_id in ids), ids
        assert len(set(ids)) == 4

    def test_a_sections_location_carries_its_locations_id(self, client, market):
        _put(client, _without_ids(_plan()))

        stored = _stored(market)
        by_name = {location["name"]: location["id"] for location in stored["locations"]}
        for section in stored["sections"]:
            assert section["location"]["id"] == by_name[section["location"]["name"]]

    def test_a_second_write_keeps_the_same_ids(self, client, market):
        _put(client, _without_ids(_plan()))
        first = copy.deepcopy(_stored(market))

        _put(client, _without_ids(_plan()))
        assert _stored(market)["locations"] == first["locations"]
        assert _stored(market)["sections"] == first["sections"]

        _put(client, copy.deepcopy(first))
        assert _stored(market)["sections"] == first["sections"]

    def test_a_stored_plan_without_ids_reads_with_the_same_ids_every_time(self, market):
        market.doc["setupObject"] = _without_ids(_plan())

        first, second = _read(market), _read(market)

        assert [s.id for s in first.sections] == [s.id for s in second.sections]
        assert [loc.id for loc in first.locations] == [loc.id for loc in second.locations]

    def test_ids_the_write_carries_are_kept(self, client, market):
        _put(client, _plan())

        assert [location["id"] for location in _stored(market)["locations"]] == [
            "loc-upper", "loc-lower"]
        assert [section["id"] for section in _stored(market)["sections"]] == [
            "sec-gold", "sec-blue"]

    def test_two_sections_of_one_name_get_two_ids(self, client, market):
        plan = _without_ids(_plan())
        plan["sections"].append(copy.deepcopy(plan["sections"][0]))

        _put(client, plan)

        ids = [section["id"] for section in _stored(market)["sections"]]
        assert len(set(ids)) == 3


class TestAPageFromBeforeIds:
    """A tab still on the bundle before ids sends its locations and sections without them, which
    read with ids derived from their names: where the stored ids are not those, the write would
    drop a layout and delete its image, so it is refused whole; where they are, it lands."""

    def _laid_out_with_minted_ids(self, market):
        plan = _plan()
        plan["floorplans"] = [_layout(tables=2)]
        market.doc["setupObject"] = plan

    def test_it_is_refused_where_a_location_has_an_id_its_name_does_not_give(
            self, client, market, market_records):
        self._laid_out_with_minted_ids(market)
        before = copy.deepcopy(_stored(market))

        response = _put(client, _without_ids(_plan()))

        assert response.status_code == 409, response.get_json()
        assert response.get_json()["error"] == MarketsApi.PAGE_FROM_BEFORE_IDS
        assert _stored(market) == before
        assert _entries(market_records, History.FLOORPLAN_REMOVED) == []

    def test_it_lands_where_every_stored_id_is_the_one_its_name_gives(self, client, market):
        _put(client, _without_ids(_plan()))
        derived = copy.deepcopy(_stored(market))

        response = _put(client, _without_ids(_plan(tiers=[{"id": 0, "name": "Silver"}])))

        assert response.status_code == 200, response.get_json()
        assert _stored(market)["locations"] == derived["locations"]

    def test_this_page_on_a_market_before_ids_writes_on_after_adding_a_location(
            self, client, market):
        """A page of this bundle reads a market stored before ids as stored, its rows with none,
        and mints an id only for a row it adds: its writes after the first carry both."""
        read = _without_ids(_plan())
        added = {"id": "loc-minted", "name": "Annex"}
        first = copy.deepcopy(read)
        first["locations"].append(added)

        assert _put(client, first).status_code == 200
        second = copy.deepcopy(first)
        second["tiers"] = [{"id": 0, "name": "Silver"}]
        response = _put(client, second)

        assert response.status_code == 200, response.get_json()

    def test_a_location_renamed_by_it_on_a_laid_out_market_is_refused(self, client, market):
        _put(client, _without_ids(_plan()))
        derived = copy.deepcopy(_stored(market))
        derived["floorplans"] = [_layout(tables=2, location=derived["locations"][0]["id"])]
        market.doc["setupObject"] = derived
        renamed = _without_ids(_plan())
        renamed["locations"][0]["name"] = "Great Hall"
        renamed["sections"][0]["location"]["name"] = "Great Hall"

        response = _put(client, renamed)

        assert response.status_code == 409, response.get_json()
        assert len(_stored(market)["floorplans"]) == 1


class TestASectionsLocationCopy:

    def test_a_copy_whose_stored_id_is_a_locations_keeps_it_whatever_its_name(self):
        from datatypes import fill_plan_ids

        filled = fill_plan_ids({
            "locations": [{"id": "L1", "name": "B"}, {"id": "L2", "name": "A"}],
            "sections": [{"id": "s", "name": "Gold row", "count": 1,
                          "location": {"id": "L1", "name": "A"}}],
        })

        assert filled["sections"][0]["location"]["id"] == "L1"

    def test_a_copy_of_no_id_takes_the_id_of_the_location_of_its_name(self):
        from datatypes import fill_plan_ids

        filled = fill_plan_ids({
            "locations": [{"id": "L1", "name": "B"}, {"id": "L2", "name": "A"}],
            "sections": [{"id": "s", "name": "Gold row", "count": 1, "location": {"name": "A"}}],
        })

        assert filled["sections"][0]["location"]["id"] == "L2"


class TestThePlanWriteKeepsTheStoredLayouts:

    def test_a_changed_floorplans_or_table_types_in_the_body_is_ignored(self, client, market):
        stored = _plan(floorplans=[_layout(3)], tableTypes=[SIX_FOOT])
        market.doc["setupObject"] = copy.deepcopy(stored)
        sent = _plan(
            floorplans=[_layout(5, image="img-other")],
            tableTypes=[{**SIX_FOOT, "name": "Long 8 ft", "widthMm": 2440}],
        )

        response = _put(client, sent)

        assert response.status_code == 200, response.get_json()
        assert _read(market).floorplans == _model(stored).floorplans
        assert _read(market).table_types == _model(stored).table_types

    def test_a_body_with_no_floorplans_keeps_the_stored_ones(self, client, market):
        market.doc["setupObject"] = _plan(floorplans=[_layout(3)], tableTypes=[SIX_FOOT])

        _put(client, _plan())

        assert [floorplan["id"] for floorplan in _stored(market)["floorplans"]] == ["fp-upper"]
        assert _stored(market)["tableTypes"] == [SIX_FOOT]

    def test_a_market_with_no_layout_stores_none_and_no_types(self, client, market):
        _put(client, _plan(floorplans=[_layout(3)], tableTypes=[SIX_FOOT]))

        assert _stored(market)["floorplans"] is None
        assert _stored(market)["tableTypes"] == []

    def test_the_plan_entry_does_not_list_floorplans(self, client, market, market_records):
        market.doc["setupObject"] = _plan(floorplans=[_layout(3)])

        _put(client, _plan(locations=[copy.deepcopy(LOWER)],
                           sections=[_plan()["sections"][1]]))

        (entry,) = _entries(market_records, History.PLAN)
        assert "floorplans" not in entry["detail"]["before"]
        assert "floorplans" not in entry["detail"]["after"]


class TestTypesWrittenBetweenTheReadAndTheWrite:
    """The plan write ignores the body's table types and keeps the stored ones, so types written
    by their own write between its read and its write must be the ones it keeps: it reads the
    market again and writes once more (review of ticket 10)."""

    def test_types_changed_in_between_are_kept_and_the_plan_lands(
            self, client, market, market_records, monkeypatch):
        market.doc["setupObject"] = _plan(tableTypes=[SIX_FOOT])
        square = {"id": "tt-square", "name": "Square 4 ft", "widthMm": 1220, "depthMm": 1220}
        read = market.find_one
        landed = []

        def read_then_types_land(query, projection=None):
            found = read(query, projection)
            if not landed:
                landed.append(True)
                market.doc["setupObject"]["tableTypes"] = [dict(SIX_FOOT), dict(square)]
            return found

        monkeypatch.setattr(market, "find_one", read_then_types_land)

        response = _put(client, _plan(marketDates=[{"date": "2099-08-09"}]))

        assert response.status_code == 200, response.get_json()
        assert [t["id"] for t in _stored(market)["tableTypes"]] == ["tt-six", "tt-square"]
        assert _stored(market)["marketDates"] == [{"date": "2099-08-09"}]

    def test_types_changing_at_every_try_refuse_it(
            self, client, market, market_records, monkeypatch):
        market.doc["setupObject"] = _plan(tableTypes=[SIX_FOOT])
        read = market.find_one
        widths = iter(range(2000, 2100))

        def read_then_types_land(query, projection=None):
            found = read(query, projection)
            market.doc["setupObject"]["tableTypes"] = [{**SIX_FOOT, "widthMm": next(widths)}]
            return found

        monkeypatch.setattr(market, "find_one", read_then_types_land)

        response = _put(client, _plan(marketDates=[{"date": "2099-08-09"}]))

        assert response.status_code == 409
        assert response.get_json() == {"error": MarketsApi.PLAN_RACED}
        assert _stored(market)["marketDates"] == [{"date": "2099-08-01"}]


class TestALaidOutSectionCountsItsTables:

    def test_the_stored_count_is_the_layouts_whatever_the_write_sent(self, client, market):
        market.doc["setupObject"] = _plan(floorplans=[_layout(3)])

        response = _put(client, _plan())

        assert response.status_code == 200, response.get_json()
        counts = {section["name"]: section["count"] for section in _stored(market)["sections"]}
        assert counts == {"Gold row": 3, "Blue row": 7}

    def test_a_section_of_a_location_with_no_layout_keeps_its_typed_count(self, client, market):
        market.doc["setupObject"] = _plan(floorplans=[_layout(3)])
        sent = _plan()
        sent["sections"][1]["count"] = 11

        _put(client, sent)

        assert _stored(market)["sections"][1]["count"] == 11


class TestALocationRemovedTakesItsLayout:

    def _remove_upper(self, client, market, market_records):
        image = str(market_records.images.put(b"png", metadata={"marketId": MARKET_ID}))
        other = str(market_records.images.put(b"png", metadata={"marketId": MARKET_ID}))
        market.doc["setupObject"] = _plan(floorplans=[
            _layout(3, image=image), _layout(0, "loc-lower", "fp-lower", image=other)])
        response = _put(client, _plan(locations=[copy.deepcopy(LOWER)],
                                      sections=[_plan()["sections"][1]]))
        return response, image, other

    def test_its_layout_is_dropped(self, client, market, market_records):
        response, _image, _other = self._remove_upper(client, market, market_records)

        assert response.status_code == 200, response.get_json()
        assert [floorplan["id"] for floorplan in _stored(market)["floorplans"]] == ["fp-lower"]

    def test_its_image_is_deleted_and_the_others_kept(self, client, market, market_records):
        _response, image, other = self._remove_upper(client, market, market_records)

        import services.gridfs_service as GridfsService
        assert GridfsService.get_image(image) is None
        assert GridfsService.get_image(other) == b"png"

    def test_it_records_floorplan_removed(self, client, market, market_records):
        self._remove_upper(client, market, market_records)

        (entry,) = _entries(market_records, History.FLOORPLAN_REMOVED)
        assert entry["action"] == "change-setup"
        assert entry["subject"] == {"floorplan_id": "fp-upper", "location": "Upper Hall"}
        assert entry["detail"] == {"before": {"tables": 3}, "after": {"tables": None}}

    def test_a_layout_with_no_image_is_dropped_all_the_same(self, client, market, market_records):
        layout = _layout(2)
        layout.pop("imageGridfsId")
        market.doc["setupObject"] = _plan(floorplans=[layout])

        response = _put(client, _plan(locations=[copy.deepcopy(LOWER)],
                                      sections=[_plan()["sections"][1]]))

        assert response.status_code == 200, response.get_json()
        assert _stored(market)["floorplans"] == []
        assert len(_entries(market_records, History.FLOORPLAN_REMOVED)) == 1

    def test_a_refused_write_removes_nothing(self, client, market, market_records):
        image = str(market_records.images.put(b"png", metadata={"marketId": MARKET_ID}))
        market.doc["setupObject"] = _plan(floorplans=[_layout(3, image=image)])

        response = _put(client, _plan(locations=[copy.deepcopy(LOWER)], sections=[],
                                      assignmentOptions={"maxHalfTableProportionPerSection": 150}))

        assert response.status_code == 400
        import services.gridfs_service as GridfsService
        assert GridfsService.get_image(image) == b"png"
        assert _entries(market_records, History.FLOORPLAN_REMOVED) == []


class TestABetaFloorplan:
    """A floorplan the beta saved has no location: it reads, is ignored, and goes with nothing."""

    def test_it_reads_as_a_floorplan_of_no_location(self, market):
        market.doc["setupObject"] = _plan(floorplans=[copy.deepcopy(BETA_FLOORPLAN)])

        (floorplan,) = _read(market).floorplans

        assert (floorplan.id, floorplan.location_id, floorplan.tables) == ("fp-beta", None, [])

    def test_the_market_read_answers(self, client, market):
        market.doc["_id"] = "mongo-market-123"
        market.doc["setupObject"] = _plan(floorplans=[copy.deepcopy(BETA_FLOORPLAN)])

        response = client.get(f"/markets/{MARKET_ID}")

        assert response.status_code == 200, response.get_json()
        served = response.get_json()["market"]["setupObject"]
        (floorplan,) = served["floorplans"]
        assert (floorplan["id"], floorplan.get("locationId")) == ("fp-beta", None)

    def test_a_plan_write_keeps_it_and_its_counts_are_the_typed_ones(self, client, market,
                                                                    market_records):
        market.doc["setupObject"] = _plan(floorplans=[copy.deepcopy(BETA_FLOORPLAN)])

        response = _put(client, _plan())

        assert response.status_code == 200, response.get_json()
        assert [floorplan["id"] for floorplan in _stored(market)["floorplans"]] == ["fp-beta"]
        assert _stored(market)["sections"][0]["count"] == 13
        assert _entries(market_records, History.FLOORPLAN_REMOVED) == []

    def test_the_market_moves_phase(self, client, market):
        market.doc = stored_market(
            MarketPhase.ASSIGNMENT, roles={"user-owner": "owner"}, intakeMode="form",
            setupObject=_plan(floorplans=[copy.deepcopy(BETA_FLOORPLAN)]),
            applicationForm={"fields": [], "publishedAt": "2026-01-02T00:00:00Z"},
            phaseHistory=[
                {"phase": "draft", "enteredAt": "2026-01-01T00:00:00Z", "by": OWNER},
                {"phase": "applications", "enteredAt": "2026-01-02T00:00:00Z", "by": OWNER},
                {"phase": "assignment", "enteredAt": "2026-01-03T00:00:00Z", "by": OWNER},
            ],
        )

        response = client.post(f"/markets/{MARKET_ID}/transition",
                               json={"toPhase": "applications"})

        assert response.status_code == 200, response.get_json()
        assert market.doc["phase"] == "applications"

    def test_the_market_deletes(self, client, market, market_records, applications):
        market.doc["setupObject"] = _plan(floorplans=[copy.deepcopy(BETA_FLOORPLAN)])

        response = client.delete(f"/markets/{MARKET_ID}")

        assert response.status_code == 200, response.get_json()
        assert market.doc is None


def _model(plan):
    from assignment.utils import convert_keys_to_snake_case
    return SetupObject.model_validate(convert_keys_to_snake_case(plan))


class TestWhatSettlesOnLeavingDraft:
    """``setup_part`` compares the layouts' seats and the table types, not whole floorplans."""

    def test_restating_the_seats_and_types_is_not_a_change(self):
        plan = _plan(floorplans=[_layout(3)], tableTypes=[SIX_FOOT])

        assert MarketsApi.setup_part(_model(plan)) == MarketsApi.setup_part(_model(plan))

    def test_a_table_moved_turned_or_a_new_image_is_not_a_change(self):
        moved = _layout(3, image="img-new")
        moved["tables"][0] = {**moved["tables"][0], "xMm": 4321.0, "rotation": 90.0}

        assert MarketsApi.setup_part(_model(_plan(floorplans=[_layout(3)]))) == \
            MarketsApi.setup_part(_model(_plan(floorplans=[moved])))

    @pytest.mark.parametrize("field,value", [
        ("id", "g-other"), ("sectionId", "sec-blue"), ("number", 9), ("tableTypeId", "tt-other"),
    ])
    def test_a_changed_seat_is_a_change(self, field, value):
        changed = _layout(3)
        changed["tables"][0] = {**changed["tables"][0], field: value}

        assert MarketsApi.setup_part(_model(_plan(floorplans=[_layout(3)]))) != \
            MarketsApi.setup_part(_model(_plan(floorplans=[changed])))

    def test_a_changed_type_is_a_change(self):
        assert MarketsApi.setup_part(_model(_plan(tableTypes=[SIX_FOOT]))) != \
            MarketsApi.setup_part(_model(_plan(tableTypes=[{**SIX_FOOT, "depthMm": 900}])))

    def test_a_settled_markets_plan_write_restating_its_layout_saves(self, client, market):
        market.doc = stored_market(
            MarketPhase.ASSIGNMENT, roles={"user-owner": "owner"},
            setupObject=_plan(floorplans=[_layout(3)], tableTypes=[SIX_FOOT]),
        )
        market.doc["setupObject"]["sections"][0]["count"] = 3

        # The working copy as Market Setup read it, carrying a count typed before the layout.
        response = _put(client, _plan(floorplans=[_layout(3)], tableTypes=[SIX_FOOT]))

        assert response.status_code == 200, response.get_json()

    def test_a_settled_markets_plan_write_changing_a_typed_count_is_refused(self, client, market):
        market.doc = stored_market(MarketPhase.ASSIGNMENT, roles={"user-owner": "owner"},
                                   setupObject=_plan(floorplans=[_layout(3)]))
        market.doc["setupObject"]["sections"][0]["count"] = 3
        sent = _plan()
        sent["sections"][1]["count"] = 8

        response = _put(client, sent)

        assert response.status_code == 400
        assert "settled" in response.get_json()["error"]
