"""Renaming is its own write, and only while the market is a draft (E21/F03/S04).

The name decides the slug, and the slug is the market's public address - the applicant link while
applications are open, the check-in page and any printed QR code once published. A rename after
draft moves an address that has already been shared, so it is refused with that reason rather than
silently breaking the links. Decided in the-market-frame ticket 04.
"""
import pytest

from conftest import FakeSlugMarketsCollection, stored_market

import api.markets as MarketsApi
import api.permissions as PermissionsApi
from datatypes import MarketPhase, MarketRole


@pytest.fixture
def market(monkeypatch):
    checked = {}

    def permission(_user, _market, role, *_args, **_kwargs):
        checked["role"] = role
        return True

    def at(phase=MarketPhase.DRAFT):
        fake = FakeSlugMarketsCollection(
            [
                stored_market(phase=phase, name="Spring Market", id="market-123"),
                stored_market(name="Café Market", id="market-cafe"),
            ]
        )
        monkeypatch.setattr(MarketsApi, "markets_collection", fake)
        return fake

    monkeypatch.setattr(PermissionsApi, "user_has_permission", permission)
    at.checked = checked
    return at


def test_a_draft_is_renamed_and_its_address_moves_with_it(market):
    collection = market()

    MarketsApi.rename_market("market-123", "Autumn Market", "user-1")

    assert collection.last_update["$set"] == {"name": "Autumn Market", "slug": "autumn-market"}


def test_it_requires_the_role_renaming_always_required(market):
    market()

    MarketsApi.rename_market("market-123", "Autumn Market", "user-1")

    assert market.checked["role"] == MarketRole.EDITOR


@pytest.mark.parametrize("phase", [phase for phase in MarketPhase if phase != MarketPhase.DRAFT])
def test_after_draft_the_name_is_the_address_that_was_shared(market, phase):
    collection = market(phase=phase)

    with pytest.raises(ValueError, match="already been shared"):
        MarketsApi.rename_market("market-123", "Autumn Market", "user-1")

    assert collection.last_update is None


def test_a_taken_address_is_refused(market):
    collection = market()

    with pytest.raises(ValueError, match="web address"):
        MarketsApi.rename_market("market-123", "Cafe Market", "user-1")

    assert collection.last_update is None


@pytest.mark.parametrize("name", ["", "   "])
def test_a_market_must_be_called_something(market, name):
    market()

    with pytest.raises(ValueError, match="name"):
        MarketsApi.rename_market("market-123", name, "user-1")
