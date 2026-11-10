"""A write judged on the market as read is refused when the market moved before it landed.

Each test lands a second change between the request's read and its write (``interleave``), the
change made through its own module function, and asserts what a person and a later reader see:
the 409 and its one sentence, the stored market as the other change left it, and no history entry.
"""
import pytest

from datatypes import MarketPhase
from market_write import MARKET_CHANGED

ORGANIZER = "fixture-organizer@example.com"
CHANGED = {"error": MARKET_CHANGED, "code": "market_changed"}


def _move(market, to_phase):
    """Move ``market`` (the document as stored) to ``to_phase`` through the one phase writer."""
    import api.markets as MarketsApi

    return lambda: MarketsApi.apply_phase_transition(market["id"], market, to_phase.value)


def _stored(real_db, market):
    return real_db["markets"].find_one({"id": market["id"]})


def _history(market_records, market):
    return list(market_records.history.find({"market_id": market["id"]}))


class TestARenameJudgedOnADraft:
    def test_is_refused_when_applications_opened_before_it_landed(
            self, signed_in, market_in, interleave, real_db, market_records):
        client = signed_in(ORGANIZER)
        market = market_in(MarketPhase.DRAFT)
        interleave("api.markets._load_market_to_change", _move(market, MarketPhase.APPLICATIONS))

        response = client.put(f"/markets/{market['id']}/name", json={"name": "Fixture New Name"})

        assert response.status_code == 409, response.get_json()
        assert response.get_json() == CHANGED
        stored = _stored(real_db, market)
        assert stored["phase"] == MarketPhase.APPLICATIONS.value
        # The public address handed out when applications opened has not moved.
        assert (stored["name"], stored["slug"]) == (market["name"], market["slug"])
        assert _history(market_records, market) == []


class TestARejectionRulesSaveJudgedOnAnOpenReview:
    def test_is_refused_when_the_review_closed_before_it_landed(
            self, signed_in, market_in, interleave, real_db, market_records):
        import essential_fields as EssentialFields

        client = signed_in(ORGANIZER)
        market = market_in(MarketPhase.APPLICATIONS)
        interleave("api.markets._load_market_to_change", _move(market, MarketPhase.ASSIGNMENT))

        response = client.put(f"/markets/{market['id']}/rejection-rules", json={
            "rules": [{"key": EssentialFields.TABLE_CHOICE_KEY, "answers": ["half"]}]})

        assert response.status_code == 409, response.get_json()
        assert response.get_json() == CHANGED
        stored = _stored(real_db, market)
        assert stored["phase"] == MarketPhase.ASSIGNMENT.value
        assert "rejectionRules" not in stored
        assert _history(market_records, market) == []


class TestAHighlightsSaveJudgedOnALiveMarket:
    @pytest.mark.parametrize("phase", [MarketPhase.APPLICATIONS, MarketPhase.MARKET_DAYS])
    def test_is_refused_when_the_market_was_archived_before_it_landed(
            self, phase, signed_in, market_in, interleave, real_db, market_records):
        client = signed_in(ORGANIZER)
        market = market_in(phase)
        interleave("api.markets._load_market_to_change", _move(market, MarketPhase.ARCHIVED))

        response = client.put(f"/markets/{market['id']}/review-highlights",
                              json={"keys": ["business_name"]})

        assert response.status_code == 409, response.get_json()
        assert response.get_json() == CHANGED
        stored = _stored(real_db, market)
        assert stored["phase"] == MarketPhase.ARCHIVED.value
        assert "reviewHighlights" not in stored
        assert _history(market_records, market) == []


class TestAWriteThatMeetsTheMarketAsItReadIt:
    """The same three, with nothing in between, land as they always did."""

    def test_a_rename_of_a_draft_lands(self, signed_in, market_in, real_db, market_records):
        client = signed_in(ORGANIZER)
        market = market_in(MarketPhase.DRAFT)

        response = client.put(f"/markets/{market['id']}/name", json={"name": "Fixture New Name"})

        assert response.status_code == 200, response.get_json()
        stored = _stored(real_db, market)
        assert (stored["name"], stored["slug"]) == ("Fixture New Name", "fixture-new-name")
        assert [entry["kind"] for entry in _history(market_records, market)] == ["renamed"]

    def test_a_rejection_rules_save_lands(self, signed_in, market_in, real_db, market_records):
        import essential_fields as EssentialFields

        client = signed_in(ORGANIZER)
        market = market_in(MarketPhase.APPLICATIONS)
        rules = [{"key": EssentialFields.TABLE_CHOICE_KEY, "answers": ["half"]}]

        response = client.put(f"/markets/{market['id']}/rejection-rules", json={"rules": rules})

        assert response.status_code == 200, response.get_json()
        assert _stored(real_db, market)["rejectionRules"] == rules
        assert [entry["kind"] for entry in _history(market_records, market)] == ["rejection_rules"]

    def test_a_highlights_save_lands(self, signed_in, market_in, real_db, market_records):
        client = signed_in(ORGANIZER)
        market = market_in(MarketPhase.APPLICATIONS)

        response = client.put(f"/markets/{market['id']}/review-highlights",
                              json={"keys": ["business_name"]})

        assert response.status_code == 200, response.get_json()
        assert _stored(real_db, market)["reviewHighlights"] == ["business_name"]
        assert [entry["kind"] for entry in _history(market_records, market)] == ["review_highlights"]
