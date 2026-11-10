"""A floorplan save leaves its market readable, whatever the market held and whatever was sent (T272).

The save used to write the floorplan's sections, locations and floorplan into the stored plan by
hand. On a market whose plan was never saved that made a plan of those three alone, which does not
parse, so the market answered as missing to every reader and refused every write, its own Delete
included; a hand-made body did the same with one wrong field, stored any key it carried, and every
save appended another copy of the floorplan. The save now parses the floorplan and writes through
the plan's own writer (``prepared_plan``), so what is stored is a plan that reads.

``FakeMarketsCollection`` records an update and does not apply it, so each test here applies the
recorded ``$set`` to the stored document itself and parses the result with ``market_from_document``,
which is what every reader of the market does.
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
from datatypes import MarketPhase
from market_documents import market_from_document
from utils.request_body import NOT_AN_OBJECT

MARKET_ID = "market-123"
ACCOUNTS = {
    "owner@example.com": "user-owner",
    "editor@example.com": "user-editor",
    "viewer@example.com": "user-viewer",
}
ROLES = {"user-owner": "owner", "user-editor": "editor", "user-viewer": "viewer"}

#: A plan with something in every field, as Market Setup stores it.
FULL_PLAN = {
    "priority": [{"id": 0, "target": "application.submitted_at", "direction": "ascending"}],
    "marketDates": [{"date": "2099-08-01"}, {"date": "2099-08-02"}],
    "tiers": [{"id": 0, "name": "Gold"}, {"id": 1, "name": "Silver"}],
    "locations": [{"name": "Old Hall"}],
    "sections": [{"name": "Old Row", "count": 6, "location": {"name": "Old Hall"},
                  "tier": {"id": 0, "name": "Gold"}}],
    "assignmentOptions": {"maxAssignmentsPerVendor": 2, "maxHalfTableProportionPerSection": 30},
    "pricing": {"currency": "CAD", "halfTablePercent": 50, "groups": [],
                "everyoneElse": [{"tier": "Gold", "cents": 3500}]},
}


def _floorplan(floorplan_id="fp-1", section="Hall A", **overrides):
    """A floorplan as the wizard sends it: camelCase, two tables grouped into one section."""
    floorplan = {
        "id": floorplan_id,
        "scalePxPerUnit": 0.1,
        "scaleUnit": "mm",
        "tableTypes": [{"id": "tt-1", "name": "6ft Table", "widthMm": 1800, "heightMm": 900,
                        "maxCapacity": 2}],
        "walls": [{"id": "w-1", "start": [0, 0], "end": [400, 0], "thicknessMm": 200}],
        "obstacles": [],
        "placedTables": [
            {"id": "t-1", "tableTypeId": "tt-1", "x": 40, "y": 40, "widthMm": 1800, "heightMm": 900},
            {"id": "t-2", "tableTypeId": "tt-1", "x": 80, "y": 40, "widthMm": 1800, "heightMm": 900},
        ],
        "sections": [{"id": "s-1", "name": section, "locationName": "Main Hall",
                      "tableIds": ["t-1", "t-2"], "tierId": "tier_0"}],
    }
    floorplan.update(overrides)
    return floorplan


def _account(email):
    if email not in ACCOUNTS:
        return None
    return SimpleNamespace(
        id=ACCOUNTS[email], email=email, is_active=True, is_authenticated=True,
        is_anonymous=False, get_id=lambda e=email: e,
    )


@pytest.fixture
def market(monkeypatch):
    """The market every save names, a draft with no plan, as the new-market dialog leaves it."""
    markets = FakeMarketsCollection(stored_market(MarketPhase.DRAFT, roles=dict(ROLES)))
    monkeypatch.setattr(MarketsApi, "markets_collection", markets)
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


def _save(client, floorplan, market_id=MARKET_ID):
    return client.post("/floorplans/save-to-market",
                       json={"market_id": market_id, "floorplan": floorplan})


def _applied(document, update):
    """``document`` with ``update``'s ``$set`` and ``$push`` applied, as Mongo would apply them."""
    result = copy.deepcopy(document)
    for key, value in update.get("$set", {}).items():
        *parents, leaf = key.split(".")
        target = result
        for part in parents:
            target = target.setdefault(part, {})
        target[leaf] = copy.deepcopy(value)
    for key, value in update.get("$push", {}).items():
        *parents, leaf = key.split(".")
        target = result
        for part in parents:
            target = target.setdefault(part, {})
        target.setdefault(leaf, []).append(copy.deepcopy(value))
    return result


def _saved_plan(market):
    """The market as the next reader parses it, once the recorded write has landed."""
    assert market.last_update is not None, "the save wrote nothing"
    return market_from_document(_applied(market.doc, market.last_update)).setup_object


def _floorplan_entries(market_records):
    return [entry for entry in market_records.history.documents
            if entry.get("kind") == History.FLOORPLAN]


class TestAMarketWithNoPlan:

    def test_it_saves_and_reads_with_the_empty_plan_and_the_floorplans_sections(
        self, client, market,
    ):
        response = _save(client, _floorplan())

        assert response.status_code == 200, response.get_json()
        plan = _saved_plan(market)
        assert plan.priority == []
        assert plan.market_dates == []
        assert plan.tiers == []
        assert plan.assignment_options.max_assignments_per_vendor is None
        assert plan.assignment_options.max_half_table_proportion_per_section is None
        assert plan.pricing is None
        assert [location.name for location in plan.locations] == ["Main Hall"]
        (section,) = plan.sections
        assert (section.name, section.location.name, section.count) == ("Hall A", "Main Hall", 2)
        assert [floorplan.id for floorplan in plan.floorplans] == ["fp-1"]

    def test_it_writes_the_whole_plan_in_one_set(self, client, market):
        _save(client, _floorplan())

        assert set(market.last_update) == {"$set"}
        assert set(market.last_update["$set"]) == {"setupObject"}


class TestAMarketWithAPlan:

    def test_only_sections_locations_and_floorplans_change(self, client, market):
        market.doc["setupObject"] = copy.deepcopy(FULL_PLAN)
        before = market_from_document(market.doc).setup_object

        response = _save(client, _floorplan())

        assert response.status_code == 200, response.get_json()
        after = _saved_plan(market)
        replaced = {"sections", "locations", "floorplans"}
        assert after.model_dump(exclude=replaced) == before.model_dump(exclude=replaced)
        assert [section.name for section in after.sections] == ["Hall A"]
        assert [location.name for location in after.locations] == ["Main Hall"]

    def test_a_floorplan_saved_again_replaces_itself_in_place(self, client, market, market_records):
        market.doc["setupObject"] = {**copy.deepcopy(FULL_PLAN), "floorplans": [
            _floorplan("fp-0", section="Other"), _floorplan("fp-1", section="First try"),
        ]}

        response = _save(client, _floorplan("fp-1", section="Second try"))

        assert response.status_code == 200, response.get_json()
        floorplans = _saved_plan(market).floorplans
        assert [floorplan.id for floorplan in floorplans] == ["fp-0", "fp-1"]
        assert floorplans[1].sections[0].name == "Second try"
        # The same ids before and after, so the entry names only the sections and locations.
        (entry,) = _floorplan_entries(market_records)
        assert "floorplan_ids" not in entry["detail"]["after"]
        assert [section["name"] for section in entry["detail"]["after"]["sections"]] == [
            "Second try"]

    def test_a_floorplan_of_a_new_id_is_added(self, client, market, market_records):
        market.doc["setupObject"] = {**copy.deepcopy(FULL_PLAN), "floorplans": [_floorplan("fp-0")]}

        response = _save(client, _floorplan("fp-1"))

        assert response.status_code == 200, response.get_json()
        assert [floorplan.id for floorplan in _saved_plan(market).floorplans] == ["fp-0", "fp-1"]
        (entry,) = _floorplan_entries(market_records)
        assert entry["detail"]["before"]["floorplan_ids"] == ["fp-0"]
        assert entry["detail"]["after"]["floorplan_ids"] == ["fp-0", "fp-1"]

    def test_a_refusal_of_the_plans_own_writer_answers_its_own_sentence(self, client, market):
        """A rule of the plan write holds here too, and answers as the plan write does: a stored
        share out of range, from before the plan write refused one, is refused with its sentence,
        not swallowed into an "Internal server error"."""
        market.doc["setupObject"] = {
            **copy.deepcopy(FULL_PLAN),
            "assignmentOptions": {"maxHalfTableProportionPerSection": 150},
        }

        response = _save(client, _floorplan())

        assert response.status_code == 400
        assert "max_half_table_proportion_per_section" in response.get_json()["error"]
        assert market.last_update is None


class TestTheSaveIsRecorded:

    def test_one_floorplan_entry_and_no_plan_entry(self, client, market, market_records):
        market.doc["setupObject"] = copy.deepcopy(FULL_PLAN)

        _save(client, _floorplan())

        (entry,) = _floorplan_entries(market_records)
        assert entry["action"] == Actions.CHANGE_SETUP.id
        assert entry["subject"] == {"floorplan_id": "fp-1"}
        assert entry["detail"]["before"]["floorplan_ids"] == []
        assert entry["detail"]["after"]["floorplan_ids"] == ["fp-1"]
        assert entry["detail"]["after"]["locations"] == [{"name": "Main Hall"}]
        assert not [e for e in market_records.history.documents if e.get("kind") == History.PLAN]


class TestAFloorplanThatDoesNotParse:

    @pytest.mark.parametrize("field,value", [
        ("walls", "not-a-list-7731"),
        ("sections", ["not-a-section-7731"]),
        ("placedTables", [{"id": "t-1", "x": "not-a-number-7731"}]),
        ("scalePxPerUnit", "not-a-number-7731"),
    ])
    def test_it_is_refused_naming_the_field_and_writes_nothing(
        self, client, market, market_records, caplog, field, value,
    ):
        market.doc["setupObject"] = copy.deepcopy(FULL_PLAN)

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
        junk = "x" * 100_000
        floorplan = _floorplan(junk=junk)
        floorplan["sections"][0]["extra"] = junk

        response = _save(client, floorplan)

        assert response.status_code == 200, response.get_json()
        assert "xxxxxxxxxx" not in json.dumps(market.last_update)
        stored = _applied(market.doc, market.last_update)["setupObject"]["floorplans"][0]
        assert "junk" not in stored
        assert "extra" not in stored["sections"][0]


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

    def test_a_viewer_is_refused_before_the_floorplan_is_read(self, client, market):
        response = _save(_signed_in("viewer@example.com"), _floorplan(walls="not a list"))

        assert response.status_code == 403
        assert response.get_json() == {"error": Actions.refusal_sentence(Actions.CHANGE_SETUP)}
        assert market.last_update is None

    def test_an_archived_market_is_refused_before_the_floorplan_is_read(self, client, market):
        market.doc = stored_market(MarketPhase.ARCHIVED, roles=dict(ROLES))

        response = _save(client, _floorplan(walls="not a list"))

        assert response.status_code == 403
        assert response.get_json() == {"error": MarketsApi.ARCHIVED_REFUSAL}
        assert market.last_update is None

    def test_a_settled_setup_is_refused_before_the_floorplan_is_read(self, client, market):
        market.doc = stored_market(MarketPhase.APPLICATIONS, roles=dict(ROLES),
                                   setupObject=copy.deepcopy(FULL_PLAN))

        response = _save(client, _floorplan(walls="not a list"))

        assert response.status_code == 409
        assert "settled" in response.get_json()["error"]
        assert market.last_update is None
