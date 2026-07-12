"""A market update body must not clobber lifecycle/Conventioner state it does not carry."""
from types import SimpleNamespace

import pytest

import api.markets as MarketsApi
import api.permissions as PermissionsApi
from datatypes import AssignmentObject, ApplicationForm, FormField, Market, MarketPhase, MarketRole


class FakeMarketsCollection:
    def __init__(self, doc):
        self.doc = doc
        self.last_update = None
        self.inserted = None

    def find_one(self, _query):
        return dict(self.doc) if self.doc is not None else None

    def update_one(self, _filter, update):
        self.last_update = update
        return SimpleNamespace(matched_count=1, modified_count=1, upserted_id=None)

    def insert_one(self, document):
        self.inserted = document
        return SimpleNamespace(inserted_id="mongo-id")


def _stored_market(**overrides):
    doc = {
        "id": "market-123",
        "name": "Test Market",
        "creationDate": "2026-01-01T00:00:00Z",
        "roles": {"user-1": "owner"},
        "modificationList": [],
        "assignmentObject": {"vendorAssignments": [], "assignmentStatistics": None},
        "isDraft": False,
        "phase": MarketPhase.ARCHIVED.value,
    }
    doc.update(overrides)
    return doc


def _client_market(**overrides):
    """A market body as the front-end PUTs it back: no phase, no Conventioner fields."""
    kwargs = {
        "id": "market-123",
        "name": "Renamed Market",
        "creation_date": "2026-01-01T00:00:00Z",
        "roles": {"user-1": MarketRole.OWNER},
        "modification_list": [],
        "assignment_object": AssignmentObject(),
        "is_draft": False,
    }
    kwargs.update(overrides)
    return Market(**kwargs)


@pytest.fixture
def collection(monkeypatch):
    fake = FakeMarketsCollection(_stored_market())
    monkeypatch.setattr(MarketsApi, "markets_collection", fake)
    monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_args, **_kwargs: True)
    return fake


def test_update_keeps_stored_phase(collection):
    MarketsApi.update_market("market-123", _client_market(), "user-1")

    written = collection.last_update["$set"]
    assert written["phase"] == MarketPhase.ARCHIVED.value
    assert written["name"] == "Renamed Market"


def test_update_cannot_set_phase_from_the_client_body(collection):
    MarketsApi.update_market("market-123", _client_market(phase=MarketPhase.DRAFT), "user-1")

    assert collection.last_update["$set"]["phase"] == MarketPhase.ARCHIVED.value


def test_update_keeps_conventioner_fields_the_body_omits(monkeypatch):
    fake = FakeMarketsCollection(
        _stored_market(
            applicationForm={
                "fields": [
                    {"key": "shop_name", "label": "Shop name", "type": "text", "required": True}
                ]
            },
            reviewConfig={"reviewers": ["a@example.com"]},
            discordGuildId="guild-1",
        )
    )
    monkeypatch.setattr(MarketsApi, "markets_collection", fake)
    monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_args, **_kwargs: True)

    MarketsApi.update_market("market-123", _client_market(), "user-1")

    written = fake.last_update["$set"]
    assert written["applicationForm"]["fields"][0]["label"] == "Shop name"
    assert written["reviewConfig"] == {"reviewers": ["a@example.com"]}
    assert written["discordGuildId"] == "guild-1"


def test_update_writes_conventioner_fields_the_body_does_carry(collection):
    form = ApplicationForm(fields=[FormField(key="website", label="Website", type="text")])

    MarketsApi.update_market("market-123", _client_market(application_form=form), "user-1")

    written = collection.last_update["$set"]
    assert written["applicationForm"]["fields"][0]["label"] == "Website"


def test_update_clears_conventioner_fields_the_body_explicitly_nulls(monkeypatch):
    fake = FakeMarketsCollection(
        _stored_market(
            applicationForm={
                "fields": [
                    {"key": "shop_name", "label": "Shop name", "type": "text", "required": True}
                ]
            },
            reviewConfig={"reviewers": ["a@example.com"]},
            discordGuildId="guild-1",
        )
    )
    monkeypatch.setattr(MarketsApi, "markets_collection", fake)
    monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_args, **_kwargs: True)

    body = _client_market(application_form=None, review_config=None, discord_guild_id=None)
    MarketsApi.update_market("market-123", body, "user-1")

    written = fake.last_update["$set"]
    assert written["applicationForm"] is None
    assert written["reviewConfig"] is None
    assert written["discordGuildId"] is None


def test_create_pins_phase_to_draft_regardless_of_the_client_body(monkeypatch):
    fake = FakeMarketsCollection(None)
    monkeypatch.setattr(MarketsApi, "markets_collection", fake)

    MarketsApi.create_market(_client_market(phase=MarketPhase.ARCHIVED), "user-1@example.com")

    assert fake.inserted["phase"] == MarketPhase.DRAFT.value
