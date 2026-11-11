"""What a reviewer reads first, and the automatic rejections, are each decided, "none" included
(T206, T191/F15).

An empty list and an absent one both mean "nothing is marked", and every stored market has one or
the other, so neither can say an organizer chose nothing. Each decision is a flag of its own beside
its list - ``nothingLeadsTheCard`` beside ``reviewHighlights``, ``noAutomaticRejections`` beside
``rejectionRules`` - written only by that list's own write, true only while the list holds nothing,
and recorded in the market's history with the list.
"""
import pytest

import api.markets as MarketsApi
import market_write as MarketWrite
from conftest import FakeMarketsCollection, client_market
from datatypes import MarketPhase
from test_every_write_records import FORM_WITH_A_FIELD, MARKET, STUDENT, client, world  # noqa: F401

FORM = {"fields": [*FORM_WITH_A_FIELD["fields"], STUDENT]}


def _draft(world, **overrides):
    return world.market(MarketPhase.DRAFT, applicationForm=FORM, **overrides)


def _highlights(client, body):
    return client.put(f"/markets/{MARKET}/review-highlights", json=body)


def _rules(client, body):
    return client.put(f"/markets/{MARKET}/rejection-rules", json=body)


class TestNothingLeadsTheCard:
    def test_it_is_stored_and_answered(self, client, world):
        _draft(world)

        response = _highlights(client, {"keys": [], "nothingLeadsTheCard": True})

        assert response.status_code == 200, response.get_json()
        assert response.get_json() == {"reviewHighlights": [], "nothingLeadsTheCard": True}
        assert world.markets.doc["reviewHighlights"] == []
        assert world.markets.doc["nothingLeadsTheCard"] is True

    def test_marking_an_answer_replaces_it(self, client, world):
        _draft(world, reviewHighlights=[], nothingLeadsTheCard=True)

        response = _highlights(client, {"keys": ["business_name"]})

        assert response.get_json() == {
            "reviewHighlights": ["business_name"], "nothingLeadsTheCard": False}
        assert world.markets.doc["nothingLeadsTheCard"] is False

    def test_it_is_refused_beside_a_marked_answer(self, client, world):
        _draft(world)

        response = _highlights(client, {"keys": ["business_name"], "nothingLeadsTheCard": True})

        assert response.status_code == 400
        assert "Nothing leads the card" in response.get_json()["error"]
        assert "nothingLeadsTheCard" not in world.markets.doc

    @pytest.mark.parametrize("flag", ["true", 1, None, []])
    def test_it_is_a_json_boolean_or_refused(self, client, world, flag):
        _draft(world)

        response = _highlights(client, {"keys": [], "nothingLeadsTheCard": flag})

        assert response.status_code == 400
        assert response.get_json() == {"error": "nothingLeadsTheCard is true or false."}
        assert "nothingLeadsTheCard" not in world.markets.doc

    def test_it_is_recorded_with_the_highlights(self, client, world):
        _draft(world, reviewHighlights=["business_name"])

        _highlights(client, {"keys": [], "nothingLeadsTheCard": True})

        [entry] = world.history.documents
        assert entry["kind"] == "review_highlights"
        assert entry["detail"] == {
            "before": {"review_highlights": ["business_name"], "nothing_leads_the_card": False},
            "after": {"review_highlights": [], "nothing_leads_the_card": True},
        }

    def test_a_write_that_changes_only_the_flag_is_recorded(self, client, world):
        _draft(world, reviewHighlights=[])

        _highlights(client, {"keys": [], "nothingLeadsTheCard": True})

        [entry] = world.history.documents
        assert entry["detail"] == {
            "before": {"nothing_leads_the_card": False}, "after": {"nothing_leads_the_card": True}}

    def test_restating_it_records_nothing(self, client, world):
        _draft(world, reviewHighlights=[], nothingLeadsTheCard=True)

        _highlights(client, {"keys": [], "nothingLeadsTheCard": True})

        assert world.history.documents == []


class TestNoAutomaticRejections:
    def test_it_is_stored_and_answered(self, client, world):
        _draft(world)

        response = _rules(client, {"rules": [], "noAutomaticRejections": True})

        assert response.status_code == 200, response.get_json()
        assert response.get_json() == {"rejectionRules": [], "noAutomaticRejections": True}
        assert world.markets.doc["rejectionRules"] == []
        assert world.markets.doc["noAutomaticRejections"] is True

    def test_adding_a_rule_replaces_it(self, client, world):
        _draft(world, rejectionRules=[], noAutomaticRejections=True)

        response = _rules(client, {"rules": [{"key": "student", "answers": ["No"]}]})

        assert response.get_json() == {
            "rejectionRules": [{"key": "student", "answers": ["No"]}],
            "noAutomaticRejections": False,
        }
        assert world.markets.doc["noAutomaticRejections"] is False

    @pytest.mark.parametrize("answers", [["No"], []])
    def test_it_is_refused_beside_a_rule(self, client, world, answers):
        # A rule with no answer yet rejects nothing, but it is a rule the organizer is building,
        # which "none" would silently discard.
        _draft(world)

        response = _rules(client, {
            "rules": [{"key": "student", "answers": answers}], "noAutomaticRejections": True})

        assert response.status_code == 400
        assert "No automatic rejections" in response.get_json()["error"]
        assert "noAutomaticRejections" not in world.markets.doc

    @pytest.mark.parametrize("flag", ["true", 0, None, {}])
    def test_it_is_a_json_boolean_or_refused(self, client, world, flag):
        _draft(world)

        response = _rules(client, {"rules": [], "noAutomaticRejections": flag})

        assert response.status_code == 400
        assert response.get_json() == {"error": "noAutomaticRejections is true or false."}

    def test_it_is_refused_once_the_rules_are_settled(self, client, world):
        world.market(MarketPhase.ASSIGNMENT, applicationForm=FORM)

        response = _rules(client, {"rules": [], "noAutomaticRejections": True})

        assert response.status_code == 400
        assert response.get_json()["error"].startswith("The automatic rejections are closed")
        assert "noAutomaticRejections" not in world.markets.doc

    def test_it_is_recorded_with_the_rules(self, client, world):
        _draft(world, rejectionRules=[{"key": "student", "answers": ["No"]}])

        _rules(client, {"rules": [], "noAutomaticRejections": True})

        [entry] = world.history.documents
        assert entry["kind"] == "rejection_rules"
        assert entry["detail"]["before"] == {
            "rejection_rules": [{"key": "student", "answers": ["No"]}],
            "no_automatic_rejections": False,
        }
        assert entry["detail"]["after"] == {
            "rejection_rules": [], "no_automatic_rejections": True}

    def test_a_write_that_changes_only_the_flag_is_recorded(self, client, world):
        _draft(world, rejectionRules=[])

        _rules(client, {"rules": [], "noAutomaticRejections": True})

        [entry] = world.history.documents
        assert entry["detail"]["before"] == {"no_automatic_rejections": False}
        assert entry["detail"]["after"] == {"no_automatic_rejections": True}

    def test_restating_it_records_nothing(self, client, world):
        _draft(world, rejectionRules=[], noAutomaticRejections=True)

        _rules(client, {"rules": [], "noAutomaticRejections": True})

        assert world.history.documents == []


class TestOnlyTheirOwnWritesSetThem:
    def test_a_new_market_starts_with_neither_whatever_its_body_says(self, monkeypatch):
        markets = FakeMarketsCollection(None)
        monkeypatch.setattr(MarketsApi, "markets_collection", markets)
        monkeypatch.setattr(MarketWrite, "markets_collection", MarketsApi.markets_collection)
        market = client_market(nothing_leads_the_card=True, no_automatic_rejections=True)

        MarketsApi.create_market(market, "owner@example.com")

        assert markets.inserted["nothingLeadsTheCard"] is False
        assert markets.inserted["noAutomaticRejections"] is False

    def test_an_absent_flag_reads_as_undecided(self, world):
        market = MarketsApi.market_from_document(_draft(world))

        assert market.nothing_leads_the_card is False
        assert market.no_automatic_rejections is False
