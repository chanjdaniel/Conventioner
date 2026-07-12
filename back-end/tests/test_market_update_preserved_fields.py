"""A market update body must not clobber lifecycle/Conventioner state it does not own."""
import pytest

from conftest import FakeMarketsCollection, client_market, stored_market

import api.markets as MarketsApi
import api.permissions as PermissionsApi
from datatypes import ApplicationForm, FormField, MarketPhase


@pytest.fixture
def collection(monkeypatch):
    fake = FakeMarketsCollection(stored_market(phase=MarketPhase.ARCHIVED))
    monkeypatch.setattr(MarketsApi, "markets_collection", fake)
    monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_args, **_kwargs: True)
    return fake


def test_update_keeps_stored_phase(collection):
    MarketsApi.update_market("market-123", client_market(name="Renamed Market"), "user-1")

    written = collection.last_update["$set"]
    assert written["phase"] == MarketPhase.ARCHIVED.value
    assert written["name"] == "Renamed Market"


def test_update_cannot_set_phase_from_the_client_body(collection):
    MarketsApi.update_market("market-123", client_market(phase=MarketPhase.DRAFT), "user-1")

    assert collection.last_update["$set"]["phase"] == MarketPhase.ARCHIVED.value


def test_update_keeps_conventioner_fields_the_body_omits(monkeypatch):
    fake = FakeMarketsCollection(
        stored_market(
            phase=MarketPhase.ARCHIVED,
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

    MarketsApi.update_market("market-123", client_market(), "user-1")

    written = fake.last_update["$set"]
    assert written["applicationForm"]["fields"][0]["label"] == "Shop name"
    assert written["reviewConfig"] == {"reviewers": ["a@example.com"]}
    assert written["discordGuildId"] == "guild-1"


def test_update_writes_conventioner_fields_the_body_does_carry(collection):
    """The application form is the exception: it is server-owned, written only by
    save_application_form. Its own coverage lives in test_application_form.py."""
    MarketsApi.update_market(
        "market-123",
        client_market(review_config={"reviewers": ["b@example.com"]}, discord_guild_id="guild-2"),
        "user-1",
    )

    written = collection.last_update["$set"]
    assert written["reviewConfig"] == {"reviewers": ["b@example.com"]}
    assert written["discordGuildId"] == "guild-2"


def test_update_clears_conventioner_fields_the_body_explicitly_nulls(monkeypatch):
    fake = FakeMarketsCollection(
        stored_market(
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

    body = client_market(application_form=None, review_config=None, discord_guild_id=None)
    MarketsApi.update_market("market-123", body, "user-1")

    written = fake.last_update["$set"]
    assert written["reviewConfig"] is None
    assert written["discordGuildId"] is None
    # An explicit null clears what the body owns, but not the server-owned form.
    assert written["applicationForm"]["fields"][0]["key"] == "shop_name"


def test_update_never_takes_the_application_form_from_the_body(collection):
    form = ApplicationForm(fields=[FormField(key="website", label="Website", type="text")])

    MarketsApi.update_market("market-123", client_market(application_form=form), "user-1")

    assert collection.last_update["$set"]["applicationForm"] is None


def test_create_pins_phase_to_draft_regardless_of_the_client_body(monkeypatch):
    fake = FakeMarketsCollection(None)
    monkeypatch.setattr(MarketsApi, "markets_collection", fake)

    MarketsApi.create_market(client_market(phase=MarketPhase.ARCHIVED), "user-1@example.com")

    assert fake.inserted["phase"] == MarketPhase.DRAFT.value
