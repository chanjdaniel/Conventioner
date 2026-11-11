"""A new market is made from an allow-list of the create body's fields.

``POST /markets`` reads the fields a person chooses when they create a market - its name, its
creation date, its organization, how vendors reach it, its plan and its form - and starts every
other field of ``Market`` at its default or writes it itself (its id, its owner, its first phase
entry and its permissions), as the plan write reads only the plan (``PLAN_WRITE_FIELDS``). A key
outside the list is dropped, not refused: an open tab of the build before sends the whole
new-market object, and nothing else in it is the creator's to decide.

The tests below post a value for every stored field of ``Market``, so a field added to it later
fails here until it is given a sample, and lands at its default until someone lists it.
"""
import pytest

from conftest import COMPLETE_PLAN, sessions_load_through_get_user
from test_the_market_keeps_its_own_rows import ORG_ID, OWNER
from test_the_organizations_default import world  # noqa: F401 - a fixture, used by name

import app as app_module
import api.markets as MarketsApi
import floorplan_limits as FloorplanLimits
import pricing as Pricing
from assignment.utils import convert_keys_to_camel_case, convert_keys_to_snake_case
from datatypes import AssignmentObject, Market, MarketPhase, SetupObject

#: A value, unlike its default, for every stored field of ``Market``, as the body spells it.
EVERY_FIELD = {
    "id": "a-chosen-id",
    "name": "Spring Fair",
    "creation_date": "2026-11-01T00:00:00Z",
    "roles": {"someone-else": "owner"},
    "organization_id": ORG_ID,
    "theme": {"primary_color": "#112233", "secondary_color": "#445566"},
    "setup_object": convert_keys_to_snake_case(COMPLETE_PLAN),
    "modification_list": [{}],
    "assignment_object": {
        "vendor_assignments": [{
            "email": "vendor@example.com", "date": "2099-08-01", "table_code": "M1",
            "table_choice": "Full Table", "section": "Main Hall", "location": "Main Hall",
            "tier": "Gold",
        }],
        "assignment_date": "2026-11-01T00:00:00Z",
        "made_from": {"vendors": "a-fingerprint"},
        "revision": 3,
    },
    "phase": MarketPhase.MARKET_DAYS.value,
    "application_form": {
        "fields": [{"key": "booth_theme", "label": "Booth theme", "type": "text"}],
    },
    "review_team": {"reviewers": [{"email": "reviewer@example.com"}], "turn": 2},
    "review_highlights": ["booth_theme"],
    "nothing_leads_the_card": True,
    "rejection_rules": [{"key": "booth_theme", "answers": ["None"]}],
    "no_automatic_rejections": True,
    "results_published": True,
    "applications_stopped": True,
    "import_mapping": {"headers": ["Name"], "targets": {"business_name": ["Name"]}},
    "example_columns": [{"key": "booth_theme", "label": "Booth theme", "type": "text"}],
    "intake_mode": "form",
    "phase_history": [{"phase": "archived"}],
    "permissions": {"check-in": {"role": "viewer", "source": "market"}},
    "discord": {"guild_id": "1234", "guild_name": "Spring Fair"},
}

#: What the server writes itself, whatever the body says, each asserted on its own below.
SERVER_WRITTEN = ("id", "roles", "phase_history", "permissions")

#: Where a required field of ``Market`` starts, since it has no default of its own.
STARTS = {"modification_list": [], "assignment_object": AssignmentObject().model_dump()}


def default_of(field: str):
    """Where ``field`` starts on a new market, as it is stored."""
    if field in STARTS:
        return STARTS[field]
    value = Market.model_fields[field].get_default(call_default_factory=True)
    return value.value if hasattr(value, "value") else value


@pytest.fixture
def created(monkeypatch, world):  # noqa: F811 - the fixture imported above
    """Post ``EVERY_FIELD`` as the market's owner and return the document stored."""
    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    sessions_load_through_get_user(monkeypatch)
    client = app_module.app.test_client()
    with client.session_transaction() as session:
        session["_user_id"] = OWNER
        session["_fresh"] = True

    response = client.post("/markets", json=convert_keys_to_camel_case(EVERY_FIELD))

    assert response.status_code == 201, response.get_json()
    market_id = response.get_json()["market_id"]
    [stored] = [doc for doc in world.markets.docs if doc["id"] == market_id]
    return stored


def test_every_stored_field_of_a_market_has_a_sample():
    assert set(EVERY_FIELD) == set(Market.model_fields)


@pytest.mark.parametrize("field", sorted(
    set(Market.model_fields) - set(MarketsApi.MARKET_CREATE_FIELDS) - set(SERVER_WRITTEN)))
def test_a_field_outside_the_allow_list_starts_at_its_default(created, field):
    assert created[convert_keys_to_camel_case({field: None}).popitem()[0]] == (
        convert_keys_to_camel_case({"value": default_of(field)})["value"])


def test_the_chosen_fields_are_stored(created):
    assert created["name"] == "Spring Fair"
    assert created["creationDate"] == "2026-11-01T00:00:00Z"
    assert created["organizationId"] == ORG_ID
    assert created["intakeMode"] == "form"
    assert created["setupObject"]["marketDates"] == [{"date": "2099-08-01"}]
    assert [field["key"] for field in created["applicationForm"]["fields"]] == ["booth_theme"]


def test_what_the_server_writes_is_its_own(created):
    assert created["id"] != "a-chosen-id"
    assert created["roles"] == {OWNER: "owner"}
    assert [entry["phase"] for entry in created["phaseHistory"]] == ["draft"]
    assert created["permissions"] == {}
    assert created["phase"] == "draft"
    assert created["isDraft"] is True


def test_the_allow_list_names_only_fields_of_a_market():
    assert set(MarketsApi.MARKET_CREATE_FIELDS) <= set(Market.model_fields)


#: A floorplan as the wizard sends it, camelCase, with one table in one section.
FLOORPLAN = {
    "id": "fp-1", "scalePxPerUnit": 0.1, "scaleUnit": "mm",
    "tableTypes": [{"id": "tt-1", "name": "6ft Table", "widthMm": 1800, "heightMm": 900,
                    "maxCapacity": 2}],
    "walls": [], "obstacles": [],
    "placedTables": [{"id": "t-1", "tableTypeId": "tt-1", "x": 40, "y": 40, "widthMm": 1800,
                      "heightMm": 900}],
    "sections": [{"id": "s-1", "name": "Main Hall", "locationName": "Main Hall",
                  "tableIds": ["t-1"]}],
}


@pytest.fixture
def post_plan(monkeypatch, world):  # noqa: F811 - the fixture imported above
    """Post a new market with ``plan`` as its plan, as its owner, and return the answer."""
    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    sessions_load_through_get_user(monkeypatch)
    client = app_module.app.test_client()
    with client.session_transaction() as session:
        session["_user_id"] = OWNER
        session["_fresh"] = True

    def post(plan):
        return client.post("/markets", json={
            "name": "Spring Fair", "creationDate": "2026-11-01T00:00:00Z",
            "organizationId": ORG_ID, "setupObject": plan,
        })

    return post


def _refused_and_unstored(response, world, sentence):  # noqa: F811
    assert response.status_code == 400, response.get_json()
    assert response.get_json() == {"error": sentence}
    assert [doc["id"] for doc in world.markets.docs] == ["market-123"]


class TestThePlanIsJudgedAsThePlanWriteJudgesIt:
    def test_a_floorplan_image_of_another_market_is_refused(
        self, post_plan, world, monkeypatch,  # noqa: F811
    ):
        monkeypatch.setattr(
            MarketsApi.GridfsService, "get_image_market_id", lambda _image: "market-9")

        response = post_plan({**COMPLETE_PLAN, "floorplans": [
            {**FLOORPLAN, "imageGridfsId": "an-image-of-market-9"}]})

        _refused_and_unstored(response, world, MarketsApi.UNTIED_FLOORPLAN_IMAGE)

    def test_a_half_table_share_over_100_is_refused(self, post_plan, world):  # noqa: F811
        response = post_plan({**COMPLETE_PLAN, "assignmentOptions": {
            "maxHalfTableProportionPerSection": 150}})

        _refused_and_unstored(response, world, (
            "max_half_table_proportion_per_section must be between 0 and 100, or null for the "
            "default."))

    def test_a_price_the_pricing_card_refuses_is_refused(self, post_plan, world):  # noqa: F811
        response = post_plan({**COMPLETE_PLAN, "pricing": {
            "currency": "CAD", "halfTablePercent": 50,
            "everyoneElse": [{"tier": "Bronze", "cents": 100}]}})

        assert response.status_code == 400, response.get_json()
        plan = SetupObject.model_validate(convert_keys_to_snake_case(
            {**COMPLETE_PLAN, "pricing": {"currency": "CAD", "halfTablePercent": 50,
                                          "everyoneElse": [{"tier": "Bronze", "cents": 100}]}}))
        _refused_and_unstored(response, world, Pricing.pricing_refusal(plan))

    def test_more_floorplans_than_a_market_holds_are_refused(self, post_plan, world):  # noqa: F811
        floorplans = [{**FLOORPLAN, "id": f"fp-{i}"}
                      for i in range(FloorplanLimits.MAX_FLOORPLANS_PER_MARKET + 1)]

        response = post_plan({**COMPLETE_PLAN, "floorplans": floorplans})

        _refused_and_unstored(response, world, FloorplanLimits.TOO_MANY_FLOORPLANS)

    def test_a_plan_the_plan_write_takes_is_stored(self, post_plan, world):  # noqa: F811
        response = post_plan({**COMPLETE_PLAN, "floorplans": [FLOORPLAN]})

        assert response.status_code == 201, response.get_json()
        [stored] = [doc for doc in world.markets.docs if doc["id"] != "market-123"]
        assert [floorplan["id"] for floorplan in stored["setupObject"]["floorplans"]] == ["fp-1"]
