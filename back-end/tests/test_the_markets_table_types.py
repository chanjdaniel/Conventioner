"""The market's table types have their own write, ``PUT /markets/:id/table-types`` (T257).

A layout's tables are sized by the market's types (``setupObject.tableTypes``), which the layout
page adds, edits and removes. The write replaces them through the plan's own writer
(``prepared_plan``), so the plan it stores reads and keeps its layouts; it refuses removing a type a
table uses, naming how many; and it asks what the layout's save asks, in the same order: the body,
the market, its data, the Market Setup row, the archived rule, the settled setup, then the types'
parse and bounds.

Each test reads what was written by applying the recorded ``$set`` to the document as it was and
parsing the result with ``market_from_document``, which is what every reader of the market does.
"""
import copy
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
import floorplan_limits as FloorplanLimits
import history as History
import market_write as MarketWrite
from api.layouts import TYPE_IN_USE_TEMPLATE, size_in_words
from datatypes import MarketPhase
from market_documents import market_from_document
from utils.request_body import NOT_AN_OBJECT

MARKET_ID = "market-123"
ACCOUNTS = {
    "owner@example.com": "user-owner",
    "editor@example.com": "user-editor",
    "viewer@example.com": "user-viewer",
    "outsider@example.com": "user-outsider",
}
ROLES = {"user-owner": "owner", "user-editor": "editor", "user-viewer": "viewer"}

UPPER = {"id": "loc-upper", "name": "Upper Hall"}
LOWER = {"id": "loc-lower", "name": "Lower Hall"}
SIX_FOOT = {"id": "tt-six", "name": "Standard 6 ft", "widthMm": 1830, "depthMm": 760}
SQUARE = {"id": "tt-square", "name": "Square 4 ft", "widthMm": 1220, "depthMm": 1220}


def _table(table_id, number, type_id, section="sec-gold", x=1000):
    return {"id": table_id, "sectionId": section, "number": number, "tableTypeId": type_id,
            "xMm": x, "yMm": 1000, "rotation": 0}


def _layout(layout_id, location, tables):
    """A calibrated layout, 20 m across, of the tables given."""
    return {
        "id": layout_id, "locationId": location, "revision": 3,
        "imageGridfsId": None, "imageWidth": 2000, "imageHeight": 1000, "scalePxPerUnit": 0.1,
        "tables": tables, "zones": [], "sectionStyles": [], "startingCounts": [],
    }


def _plan(table_types=(SIX_FOOT, SQUARE), floorplans=()):
    """Gold row in Upper Hall and Silver row in Lower Hall, each laid out by ``floorplans``."""
    return {
        "priority": [],
        "marketDates": [{"date": "2099-08-01"}],
        "tiers": [{"id": 0, "name": "Gold"}],
        "locations": [dict(UPPER), dict(LOWER)],
        "sections": [
            {"id": "sec-gold", "name": "Gold row", "count": 0, "location": dict(UPPER),
             "tier": {"id": 0, "name": "Gold"}},
            {"id": "sec-silver", "name": "Silver row", "count": 0, "location": dict(LOWER),
             "tier": {"id": 0, "name": "Gold"}},
        ],
        "assignmentOptions": {},
        "tableTypes": [dict(t) for t in table_types],
        "floorplans": [copy.deepcopy(f) for f in floorplans],
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
    """A draft market with a plan of two locations and the two types, nothing laid out."""
    markets = FakeMarketsCollection(
        stored_market(MarketPhase.DRAFT, roles=dict(ROLES), setupObject=_plan()))
    monkeypatch.setattr(MarketsApi, "markets_collection", markets)
    monkeypatch.setattr(MarketWrite, "markets_collection", markets)
    return markets


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


def _put(client, table_types, market_id=MARKET_ID):
    return client.put(f"/markets/{market_id}/table-types", json={"tableTypes": table_types})


def _saved_plan(market):
    """The market as the next reader parses it, once the recorded write has landed."""
    assert market.last_update is not None, "the write wrote nothing"
    return market_from_document(market.doc).setup_object


def _entries(market_records, kind):
    return [entry for entry in market_records.history.documents if entry.get("kind") == kind]


def _refused_and_unwritten(response, status, sentence, market):
    assert response.status_code == status, response.get_json()
    assert response.get_json() == {"error": sentence}
    assert market.last_update is None


class TestTheTypesAreReplaced:

    def test_a_type_added_is_stored_and_answered(self, client, market, market_records):
        long_table = {"id": "tt-long", "name": "Long 8 ft", "widthMm": 2440, "depthMm": 760}

        response = _put(client, [SIX_FOOT, SQUARE, long_table])

        assert response.status_code == 200, response.get_json()
        assert response.get_json() == {"tableTypes": [SIX_FOOT, SQUARE, long_table]}
        stored = _saved_plan(market).table_types
        assert [(t.id, t.name, t.width_mm, t.depth_mm) for t in stored] == [
            ("tt-six", "Standard 6 ft", 1830, 760), ("tt-square", "Square 4 ft", 1220, 1220),
            ("tt-long", "Long 8 ft", 2440, 760)]

    def test_a_type_resized_keeps_its_id_so_its_tables_follow(self, client, market, market_records):
        market.doc["setupObject"] = _plan(floorplans=[
            _layout("fp-upper", "loc-upper", [_table("t-1", 1, "tt-square")])])

        response = _put(client, [SIX_FOOT, {**SQUARE, "widthMm": 1200, "depthMm": 1200}])

        assert response.status_code == 200, response.get_json()
        plan = _saved_plan(market)
        assert plan.table_types[1].width_mm == 1200
        assert plan.floorplans[0].tables[0].table_type_id == "tt-square"

    def test_a_name_is_kept_without_the_spaces_round_it(self, client, market, market_records):
        response = _put(client, [SIX_FOOT, {**SQUARE, "name": "  Square 4 ft  "}])

        assert response.status_code == 200, response.get_json()
        assert _saved_plan(market).table_types[1].name == "Square 4 ft"

    def test_a_type_sent_with_no_id_is_given_one(self, client, market, market_records):
        response = _put(client, [SIX_FOOT, {"name": "Round", "widthMm": 1500, "depthMm": 1500}])

        assert response.status_code == 200, response.get_json()
        given = response.get_json()["tableTypes"][1]["id"]
        assert isinstance(given, str) and given

    def test_the_rest_of_the_plan_and_its_layouts_are_kept(self, client, market, market_records):
        layout = _layout("fp-upper", "loc-upper", [_table("t-1", 1, "tt-six")])
        market.doc["setupObject"] = _plan(floorplans=[layout])

        _put(client, [SIX_FOOT, SQUARE, {"id": "tt-new", "name": "New", "widthMm": 900,
                                         "depthMm": 600}])

        plan = _saved_plan(market)
        assert [f.id for f in plan.floorplans] == ["fp-upper"]
        assert plan.floorplans[0].revision == 3
        assert [s.name for s in plan.sections] == ["Gold row", "Silver row"]
        # Only the types are written, so a layout saved meanwhile is never put back.
        assert list(market.last_update["$set"]) == ["setupObject.tableTypes"]

    def test_a_layout_saved_between_the_read_and_the_write_refuses_it(
            self, client, market, market_records, monkeypatch):
        market.doc["setupObject"] = _plan(floorplans=[
            _layout("fp-upper", "loc-upper", [_table("t-1", 1, "tt-square")])])
        read = MarketsApi.markets_collection.find_one

        def read_then_a_layout_save_lands(query, projection=None):
            found = read(query, projection)
            # The layout's save lands after this read: its tables are of Standard 6 ft now.
            floorplan = market.doc["setupObject"]["floorplans"][0]
            floorplan["revision"] = 4
            floorplan["tables"][0]["tableTypeId"] = "tt-six"
            # As every write of the plan does, it counts the plan's revision (T274).
            market.doc["planRevision"] = (market.doc.get("planRevision") or 0) + 1
            return found

        monkeypatch.setattr(market, "find_one", read_then_a_layout_save_lands)

        response = _put(client, [SIX_FOOT, {**SQUARE, "name": "Square"}])

        assert response.status_code == 409
        assert response.get_json() == {"error": MarketWrite.MARKET_CHANGED,
                                       "code": "market_changed"}
        assert market.doc["setupObject"]["tableTypes"][1]["name"] == "Square 4 ft"

    @pytest.mark.parametrize("unsaved", ["absent", "null"])
    def test_a_market_whose_plan_was_never_saved_takes_types(
            self, client, market, market_records, unsaved):
        # A new market stores its plan as null (`create_market`); an older one may have none.
        if unsaved == "absent":
            market.doc.pop("setupObject")
        else:
            market.doc["setupObject"] = None

        response = _put(client, [SIX_FOOT])

        assert response.status_code == 200, response.get_json()
        assert [t.name for t in _saved_plan(market).table_types] == ["Standard 6 ft"]


class TestAWriteLandingBetweenTheReadAndTheWrite:
    """The types write holds the plan's revision as it read it: a layout saved or started between
    its read and its write counts it, and refuses the types write (review of ticket 10, T274)."""

    def _after_the_read(self, market, monkeypatch, land):
        read = MarketsApi.markets_collection.find_one

        def read_then_land(query, projection=None):
            found = read(query, projection)
            land(market.doc["setupObject"])
            # A layout save counts the plan's revision, as every write of the plan does (T274).
            market.doc["planRevision"] = (market.doc.get("planRevision") or 0) + 1
            return found

        monkeypatch.setattr(market, "find_one", read_then_land)

    def test_a_locations_first_layout_started_in_between_refuses_it(
            self, client, market, market_records, monkeypatch):
        market.doc["setupObject"] = _plan(floorplans=[
            _layout("fp-upper", "loc-upper", [_table("t-1", 1, "tt-six")])])
        self._after_the_read(market, monkeypatch, lambda plan: plan["floorplans"].append(
            _layout("fp-lower", "loc-lower",
                    [_table("t-2", 1, "tt-square", section="sec-silver")])))

        response = _put(client, [SIX_FOOT])

        assert response.status_code == 409
        assert [t["id"] for t in market.doc["setupObject"]["tableTypes"]] == [
            "tt-six", "tt-square"]

    def test_the_first_layout_of_all_started_in_between_refuses_it(
            self, client, market, market_records, monkeypatch):
        self._after_the_read(market, monkeypatch, lambda plan: plan["floorplans"].append(
            _layout("fp-lower", "loc-lower",
                    [_table("t-2", 1, "tt-square", section="sec-silver")])))

        response = _put(client, [SIX_FOOT])

        assert response.status_code == 409


class TestATypeInUseIsNotRemoved:

    def test_removing_a_type_twelve_tables_use_is_refused_with_its_count(
            self, client, market, market_records):
        # Eight in Upper Hall and four in Lower Hall: the types are the market's.
        upper = [_table(f"u-{n}", n, "tt-square", x=1000 + n * 1300) for n in range(1, 9)]
        lower = [_table(f"l-{n}", n, "tt-square", section="sec-silver", x=1000 + n * 1300)
                 for n in range(1, 5)]
        market.doc["setupObject"] = _plan(floorplans=[
            _layout("fp-upper", "loc-upper", upper), _layout("fp-lower", "loc-lower", lower)])

        response = _put(client, [SIX_FOOT])

        _refused_and_unwritten(
            response, 400, "12 tables are Square 4 ft. Change them first.", market)

    def test_one_table_is_said_as_one(self, client, market, market_records):
        market.doc["setupObject"] = _plan(floorplans=[
            _layout("fp-upper", "loc-upper", [_table("t-1", 1, "tt-square")])])

        response = _put(client, [SIX_FOOT])

        _refused_and_unwritten(
            response, 400, "1 table is Square 4 ft. Change it first.", market)

    def test_the_sentence_is_the_template_filled(self):
        assert TYPE_IN_USE_TEMPLATE.format(count="12 tables are", name="Square 4 ft",
                                           them="them") == (
            "12 tables are Square 4 ft. Change them first.")

    def test_removing_a_type_no_table_uses_works(self, client, market, market_records):
        market.doc["setupObject"] = _plan(floorplans=[
            _layout("fp-upper", "loc-upper", [_table("t-1", 1, "tt-six")])])

        response = _put(client, [SIX_FOOT])

        assert response.status_code == 200, response.get_json()
        assert [t.id for t in _saved_plan(market).table_types] == ["tt-six"]

    def test_a_beta_floorplans_tables_hold_no_type(self, client, market, market_records):
        # A floorplan of no location is the beta's, ignored until the migration drops it.
        market.doc["setupObject"] = _plan(floorplans=[
            _layout("fp-beta", None, [_table("t-1", 1, "tt-square")])])

        response = _put(client, [SIX_FOOT])

        assert response.status_code == 200, response.get_json()


class TestTheTypesAreHeldToTheirRules:

    @pytest.mark.parametrize("name", ["", "   "])
    def test_a_type_with_no_name_is_refused(self, client, market, market_records, name):
        response = _put(client, [SIX_FOOT, {**SQUARE, "name": name}])

        _refused_and_unwritten(response, 400, "Each table type needs a name.", market)

    def test_two_types_of_one_name_are_refused(self, client, market, market_records):
        response = _put(client, [SIX_FOOT, {**SQUARE, "name": " standard 6 FT"}])

        _refused_and_unwritten(
            response, 400, "Two table types are named Standard 6 ft. Give each its own name.",
            market)

    def test_two_types_of_one_id_are_refused(self, client, market, market_records):
        response = _put(client, [SIX_FOOT, {**SQUARE, "id": "tt-six"}])

        _refused_and_unwritten(response, 400, "Each table type needs its own id.", market)

    def test_more_types_than_a_market_keeps_are_refused(self, client, market, market_records):
        many = [{"id": f"tt-{n}", "name": f"Type {n}", "widthMm": 1000, "depthMm": 500}
                for n in range(FloorplanLimits.MAX_TABLE_TYPES + 1)]

        response = _put(client, many)

        _refused_and_unwritten(response, 400, FloorplanLimits.TOO_MANY_TABLE_TYPES, market)

    @pytest.mark.parametrize("side", [FloorplanLimits.MIN_TABLE_SIDE_MM - 1,
                                      FloorplanLimits.MAX_TABLE_SIDE_MM + 1])
    def test_a_side_out_of_range_is_refused(self, client, market, market_records, side):
        response = _put(client, [SIX_FOOT, {**SQUARE, "depthMm": side}])

        _refused_and_unwritten(
            response, 400, FloorplanLimits.TABLE_TYPE_SIDES_OUT_OF_RANGE, market)

    def test_a_type_that_does_not_parse_is_refused_naming_the_field(
            self, client, market, market_records):
        response = _put(client, [SIX_FOOT, {**SQUARE, "widthMm": "wide"}])

        assert response.status_code == 400
        assert "widthMm" in response.get_json()["error"]
        assert market.last_update is None


class TestTheBody:

    def test_a_body_that_is_not_an_object_is_refused(self, client, market, market_records):
        response = client.put(f"/markets/{MARKET_ID}/table-types", json=[SIX_FOOT])

        _refused_and_unwritten(response, 400, NOT_AN_OBJECT, market)

    @pytest.mark.parametrize("body", [{}, {"tableTypes": None}, {"tableTypes": "six foot"},
                                      {"tableTypes": [SIX_FOOT, "square"]}])
    def test_a_body_with_no_list_of_types_is_refused(self, client, market, market_records, body):
        response = client.put(f"/markets/{MARKET_ID}/table-types", json=body)

        _refused_and_unwritten(response, 400, "tableTypes must be a list of objects.", market)

    def test_a_body_carrying_more_is_refused_by_name(self, client, market, market_records):
        response = client.put(f"/markets/{MARKET_ID}/table-types",
                              json={"tableTypes": [SIX_FOOT], "floorplans": []})

        _refused_and_unwritten(
            response, 400,
            "The table types write carries only tableTypes; it does not accept floorplans.",
            market)


class TestWhoMayWriteThem:

    def test_without_a_session_it_asks_for_a_sign_in(self, client, market, market_records):
        response = app_module.app.test_client().put(
            f"/markets/{MARKET_ID}/table-types", json={"tableTypes": [SIX_FOOT]})

        assert response.status_code == 401
        assert market.last_update is None

    def test_an_unknown_market_is_not_found(self, client, market, market_records):
        response = _put(client, [SIX_FOOT], market_id="no-such-market")

        assert response.status_code == 404
        assert market.last_update is None

    def test_a_market_that_does_not_parse_is_refused_as_invalid(
            self, client, market, market_records):
        market.doc["setupObject"] = {"sections": [], "locations": []}

        response = _put(client, [SIX_FOOT])

        _refused_and_unwritten(response, 400, "Invalid market data", market)

    @pytest.mark.parametrize("email", ["outsider@example.com", "viewer@example.com"])
    def test_an_account_that_may_not_change_the_setup_is_refused(
            self, client, market, market_records, email):
        response = _put(_signed_in(email), [SIX_FOOT])

        _refused_and_unwritten(
            response, 403, Actions.refusal_sentence(Actions.CHANGE_SETUP), market)

    def test_the_owner_may(self, client, market, market_records):
        response = _put(_signed_in("owner@example.com"), [SIX_FOOT, SQUARE])

        assert response.status_code == 200, response.get_json()

    def test_an_archived_market_is_refused_before_the_types_are_read(
            self, client, market, market_records):
        market.doc = stored_market(MarketPhase.ARCHIVED, roles=dict(ROLES), setupObject=_plan())

        response = _put(client, [{"name": ""}])

        _refused_and_unwritten(response, 403, MarketsApi.ARCHIVED_REFUSAL, market)

    def test_a_settled_setup_is_refused_before_the_types_are_read(
            self, client, market, market_records):
        market.doc = stored_market(MarketPhase.APPLICATIONS, roles=dict(ROLES),
                                   setupObject=_plan())

        response = _put(client, [{"name": ""}])

        assert response.status_code == 409
        assert response.get_json() == {"error": MarketsApi.setup_lock_reason(
            market_from_document(market.doc))}
        assert market.last_update is None


class TestTheWriteIsRecorded:

    def test_a_change_records_the_types_before_and_after_in_words(
            self, client, market, market_records):
        _put(client, [SIX_FOOT, {**SQUARE, "widthMm": 1219.2, "depthMm": 1219.2}])

        [entry] = _entries(market_records, History.TABLE_TYPES)
        assert entry["action"] == Actions.CHANGE_SETUP.id
        assert entry["detail"] == {
            "before": {"table_types": [
                {"id": "tt-six", "name": "Standard 6 ft", "size": "183 x 76 cm"},
                {"id": "tt-square", "name": "Square 4 ft", "size": "122 x 122 cm"}]},
            "after": {"table_types": [
                {"id": "tt-six", "name": "Standard 6 ft", "size": "183 x 76 cm"},
                {"id": "tt-square", "name": "Square 4 ft", "size": "121.9 x 121.9 cm"}]},
        }

    def test_restating_the_types_records_nothing(self, client, market, market_records):
        response = _put(client, [SIX_FOOT, SQUARE])

        assert response.status_code == 200
        assert _entries(market_records, History.TABLE_TYPES) == []

    def test_no_plan_entry_is_recorded_beside_it(self, client, market, market_records):
        _put(client, [SIX_FOOT])

        assert _entries(market_records, History.PLAN) == []
        assert len(_entries(market_records, History.TABLE_TYPES)) == 1


class TestASizeInWords:

    @pytest.mark.parametrize("width, depth, words", [
        (1830, 760, "183 x 76 cm"),
        (1219.2, 1219.2, "121.9 x 121.9 cm"),
        (1000, 500.04, "100 x 50 cm"),
    ])
    def test_it_is_in_centimetres_to_a_tenth(self, width, depth, words):
        assert size_in_words(width, depth) == words
