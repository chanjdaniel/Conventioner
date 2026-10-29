"""The Pricing card, and a price on each placement (E43/F01/S01).

Market Setup holds a full-table price per day for each tier and what a half table costs; a
placement's price is its table's, by the table's tier and by whether the seat is half or full. The
prices are in cents, in the market's one currency, settle with the setup on leaving draft, and each
change is recorded in the market's history.
"""
import copy

import pytest

from conftest import COMPLETE_PLAN, FakeMarketsCollection, stored_market

import api.markets as MarketsApi
import api.permissions as PermissionsApi
import history as History
import pricing as Pricing
from client_errors import BadRequestError
from datatypes import MarketPhase, MarketTableRow, PricingObject

GOLD_AND_SILVER = {
    **COMPLETE_PLAN,
    "tiers": [{"id": 0, "name": "Gold"}, {"id": 1, "name": "Silver"}],
    "sections": [
        {"name": "Atrium", "count": 2, "location": {"name": "Main Hall"},
         "tier": {"id": 0, "name": "Gold"}},
        {"name": "Landing", "count": 2, "location": {"name": "Main Hall"},
         "tier": {"id": 1, "name": "Silver"}},
    ],
}

PRICED = {
    "currency": "CAD",
    "halfTablePercent": 50,
    "everyoneElse": [{"tier": "Gold", "cents": 3500}, {"tier": "Silver", "cents": 3000}],
}


def _pricing(**change):
    return PricingObject.model_validate({
        "currency": "CAD", "half_table_percent": 50,
        "everyone_else": [{"tier": "Gold", "cents": 3500}, {"tier": "Silver", "cents": 3000}],
        **change,
    })


class TestAPlacementsPrice:
    def test_a_full_table_costs_its_tiers_price(self):
        assert Pricing.placement_price(_pricing(), "Gold", "Full Table") == 3500

    @pytest.mark.parametrize("choice", ["Half Table", "Half Table (Left)", "Half Table (Right)"])
    def test_a_half_table_costs_the_half_tables_share(self, choice):
        assert Pricing.placement_price(_pricing(), "Silver", choice) == 1500

    def test_the_price_follows_the_table_not_what_the_vendor_picked(self):
        """Q20: the tier of the table they sit at, even one they did not pick."""
        assert Pricing.placement_price(_pricing(), "Gold", "Half Table (Left)") == 1750

    def test_a_market_with_no_prices_prices_nothing(self):
        assert Pricing.placement_price(None, "Gold", "Full Table") is None
        assert Pricing.placement_price(_pricing(everyone_else=[]), "Gold", "Full Table") is None

    def test_a_tier_with_no_price_prices_nothing(self):
        assert Pricing.placement_price(_pricing(), "Bronze", "Full Table") is None
        assert Pricing.placement_price(_pricing(), "", "Full Table") is None

    def test_a_free_table_is_a_price(self):
        free = _pricing(everyone_else=[{"tier": "Gold", "cents": 0}])
        assert Pricing.placement_price(free, "Gold", "Half Table") == 0


class TestTheHalfPrice:
    @pytest.mark.parametrize("cents, percent, half", [
        (3000, 50, 1500),
        (3001, 50, 1501),  # 1500.5 rounds up
        (3003, 50, 1502),  # 1501.5 rounds up
        (999, 33, 330),    # 329.67
        (1001, 25, 250),   # 250.25 rounds down
        (1002, 25, 251),   # 250.5 rounds up
        (3500, 100, 3500),
        (3500, 0, 0),
    ])
    def test_it_rounds_half_up_to_the_cent(self, cents, percent, half):
        assert Pricing.half_price(cents, percent) == half


@pytest.fixture
def market(monkeypatch):
    monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_kw: True)

    def at(phase=MarketPhase.DRAFT, pricing=None):
        plan = copy.deepcopy(GOLD_AND_SILVER)
        if pricing is not None:
            plan["pricing"] = copy.deepcopy(pricing)
        fake = FakeMarketsCollection(stored_market(phase=phase, setupObject=plan))
        monkeypatch.setattr(MarketsApi, "markets_collection", fake)
        return fake

    return at


def _with(pricing):
    plan = copy.deepcopy(GOLD_AND_SILVER)
    plan["pricing"] = pricing
    return {"setupObject": plan}


class TestThePlanWrite:
    def test_prices_round_trip_in_cents(self, market):
        collection = market()

        MarketsApi.save_plan("market-123", _with(PRICED), "user-1")

        assert collection.last_update["$set"]["setupObject"]["pricing"] == PRICED

    def test_a_plan_without_pricing_stays_without(self, market):
        collection = market()

        MarketsApi.save_plan("market-123", {"setupObject": GOLD_AND_SILVER}, "user-1")

        assert collection.last_update["$set"]["setupObject"]["pricing"] is None

    def test_the_card_defaults_to_canadian_dollars_and_half_off(self):
        assert PricingObject().currency == "CAD"
        assert PricingObject().half_table_percent == 50

    @pytest.mark.parametrize("what, pricing", [
        ("a negative price", {**PRICED, "everyoneElse": [{"tier": "Gold", "cents": -1}]}),
        ("a fraction of a cent", {**PRICED, "everyoneElse": [{"tier": "Gold", "cents": 35.5}]}),
        ("a price as text", {**PRICED, "everyoneElse": [{"tier": "Gold", "cents": "3500"}]}),
        ("an unknown currency", {**PRICED, "currency": "XYZ"}),
        ("a share over 100", {**PRICED, "halfTablePercent": 101}),
        ("a negative share", {**PRICED, "halfTablePercent": -5}),
        ("a tier the plan lacks", {**PRICED, "everyoneElse": [{"tier": "Bronze", "cents": 100}]}),
        ("a tier priced twice", {**PRICED, "everyoneElse": [
            {"tier": "Gold", "cents": 100}, {"tier": "Gold", "cents": 200}]}),
    ])
    def test_it_refuses(self, market, what, pricing):
        collection = market()

        with pytest.raises(BadRequestError):
            MarketsApi.save_plan("market-123", _with(pricing), "user-1")
        assert collection.last_update is None

    @pytest.mark.parametrize("phase", [MarketPhase.APPLICATIONS_OPEN, MarketPhase.ASSIGNMENT])
    def test_after_draft_a_price_change_is_refused(self, market, phase):
        """The prices settle with the rest of the setup (Q6)."""
        collection = market(phase, pricing=PRICED)
        dearer = {**PRICED, "everyoneElse": [{"tier": "Gold", "cents": 4000}]}

        with pytest.raises(BadRequestError, match="settled"):
            MarketsApi.save_plan("market-123", _with(dearer), "user-1")
        assert collection.last_update is None

    def test_after_draft_restating_the_prices_saves(self, market):
        collection = market(MarketPhase.REVIEW, pricing=PRICED)

        MarketsApi.save_plan("market-123", _with(PRICED), "user-1")

        assert collection.last_update is not None


class TestTheHistory:
    def test_a_price_change_is_recorded_with_who_and_before_and_after(self, market, market_records):
        market(pricing=PRICED)
        dearer = {**PRICED, "halfTablePercent": 60,
                  "everyoneElse": [{"tier": "Gold", "cents": 4000}, {"tier": "Silver", "cents": 3000}]}

        MarketsApi.save_plan("market-123", _with(dearer), "dana@example.com")

        entries = [doc for doc in market_records.history.documents if doc["kind"] == History.PRICING]
        assert len(entries) == 1
        entry = entries[0]
        assert entry["actor"] == "dana@example.com"
        assert entry["at"]
        assert entry["action"] == "change-setup"
        assert entry["detail"] == {
            "before": {"half_table_percent": 50,
                       "everyone_else": [{"tier": "Gold", "cents": 3500},
                                         {"tier": "Silver", "cents": 3000}]},
            "after": {"half_table_percent": 60,
                      "everyone_else": [{"tier": "Gold", "cents": 4000},
                                        {"tier": "Silver", "cents": 3000}]},
        }
        # The plan's own entry is the other cards': pricing is not repeated there.
        assert not [doc for doc in market_records.history.documents if doc["kind"] == History.PLAN]

    def test_the_first_prices_are_recorded_from_none(self, market, market_records):
        market()

        MarketsApi.save_plan("market-123", _with(PRICED), "dana@example.com")

        [entry] = [doc for doc in market_records.history.documents
                   if doc["kind"] == History.PRICING]
        assert entry["detail"]["before"] == {
            "currency": None, "half_table_percent": None, "everyone_else": None}
        assert entry["detail"]["after"]["everyone_else"][0] == {"tier": "Gold", "cents": 3500}

    def test_restating_the_prices_records_nothing(self, market, market_records):
        market(pricing=PRICED)

        MarketsApi.save_plan("market-123", _with(PRICED), "dana@example.com")

        assert not [doc for doc in market_records.history.documents
                    if doc["kind"] == History.PRICING]


def _row(table_code, slots, tier, choice):
    return MarketTableRow(
        date="2099-08-01", assignment=[email for email in slots if email],
        assignment_slots=slots, location="Main Hall", section=table_code.rsplit(" ", 1)[0],
        table_choice=choice, table_code=table_code, tier=tier,
    )


class TestTheTablesRead:
    def _tables(self, monkeypatch, pricing, rows):
        plan = copy.deepcopy(GOLD_AND_SILVER)
        if pricing is not None:
            plan["pricing"] = pricing
        monkeypatch.setattr(MarketsApi, "markets_collection", FakeMarketsCollection(
            stored_market(phase=MarketPhase.ASSIGNMENT, setupObject=plan)))
        monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_kw: True)
        monkeypatch.setattr(MarketsApi, "solver_vendors_for", lambda _market: [])
        monkeypatch.setattr(MarketsApi, "assignment_to_show", lambda market, vendors: market)
        monkeypatch.setattr(MarketsApi, "derive_market_table_rows", lambda _market: rows)
        monkeypatch.setattr(MarketsApi, "outside_solver_vendors", lambda *_a: [])
        monkeypatch.setattr(MarketsApi.ApplicationsApi, "vendor_names_for_market", lambda _id: {})
        monkeypatch.setattr(MarketsApi.ApplicationsApi, "vendor_search_terms_for_market",
                            lambda *_a: {})
        result, status = MarketsApi.get_market_tables("market-123", "viewer@example.com")
        assert status == 200
        return result["rows"]

    def test_each_occupant_carries_their_seats_price(self, monkeypatch):
        rows = self._tables(monkeypatch, PRICED, [
            _row("Atrium 1", ["ana@example.com", "ana@example.com"], "Gold", "Full Table"),
            _row("Landing 1", ["ana@example.com", "ben@example.com"], "Silver", "Half Table"),
            _row("Landing 2", [None, None], "Silver", "Full Table"),
        ])

        assert rows[0]["prices"] == [{"email": "ana@example.com", "cents": 3500}]
        assert rows[1]["prices"] == [{"email": "ana@example.com", "cents": 1500},
                                     {"email": "ben@example.com", "cents": 1500}]
        assert rows[2]["prices"] == []

    def test_a_market_with_no_prices_serves_none(self, monkeypatch):
        rows = self._tables(monkeypatch, None, [
            _row("Atrium 1", ["ana@example.com", "ana@example.com"], "Gold", "Full Table"),
        ])

        assert rows[0]["prices"] == []


def test_the_pricing_object_is_not_named_after_any_one_market():
    """Q14: the card speaks of tiers and groups only; no question is named in code."""
    assert set(PricingObject.model_fields) == {"currency", "half_table_percent", "everyone_else"}


def test_the_currency_list_is_offered_to_the_card():
    assert "CAD" in Pricing.CURRENCIES
    assert "USD" in Pricing.CURRENCIES
    assert all(len(code) == 3 and code.isupper() for code in Pricing.CURRENCIES)

