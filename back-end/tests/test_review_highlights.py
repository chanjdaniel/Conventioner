"""Which answers a reviewer reads first (E19/F03/S01).

It lives on the MARKET, never on the form. The form freezes at the first application, and an
organizer learns which answers they needed WHILE REVIEWING - after that moment. A flag on a form
field would freeze exactly when it becomes knowable, and could never mark the essential answers,
which are not form fields at all.
"""
from types import SimpleNamespace

import pytest

import api.markets as MarketsApi
import api.permissions as PermissionsApi
from conftest import FakeMarketsCollection, client_market, stored_market
from datatypes import MarketPhase, MarketRole


@pytest.fixture
def markets(monkeypatch):
    fake = FakeMarketsCollection(stored_market(MarketPhase.REVIEW))
    monkeypatch.setattr(MarketsApi, "markets_collection", fake)
    monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_kw: True)
    return fake


class TestTheFieldItself:
    def test_a_market_carries_none_by_default(self):
        # Absent means nothing is marked, which renders the card exactly as it does today.
        assert (
            MarketsApi.review_highlights_for_update(
                client_market(), SimpleNamespace(review_highlights=None, phase=MarketPhase.DRAFT)
            )
            is None
        )


class TestItIsServerOwned:
    def test_a_market_put_cannot_set_it(self):
        """Like `application_form` and `assignment_object`: one writer, and a market PUT is not it.

        A client that round-trips a market it fetched would otherwise carry a stale list back over
        whatever a reviewer had just changed mid-queue (E19/F03/S02).
        """
        existing = SimpleNamespace(review_highlights=["business_name"], phase=MarketPhase.REVIEW)
        body = client_market()
        body.review_highlights = ["something_else"]

        assert MarketsApi.review_highlights_for_update(body, existing) == ["business_name"]

    def test_and_the_stored_value_survives_a_body_that_omits_it(self):
        existing = SimpleNamespace(
            review_highlights=["business_name", "essential_available_dates"],
            phase=MarketPhase.REVIEW,
        )

        assert MarketsApi.review_highlights_for_update(client_market(), existing) == [
            "business_name",
            "essential_available_dates",
        ]


class TestSavingThem:
    """The writer itself, against the update document it hands Mongo.

    Asserting the shape and not merely the return value is the point: the first cut wrapped
    ``market_doc_set`` - which already returns ``{"$set": ...}`` - in a second ``$set``, and every
    test here passed while the live endpoint 500'd on it.
    """

    def test_it_writes_the_persisted_camelCase_key(self, markets):
        MarketsApi.save_review_highlights(
            "market-123", ["business_name", "essential_full_name"], "user-1"
        )

        assert markets.last_update == {
            "$set": {"reviewHighlights": ["business_name", "essential_full_name"]}
        }

    def test_a_repeated_key_is_kept_once_in_the_order_it_was_first_marked(self, markets):
        stored = MarketsApi.save_review_highlights(
            "market-123", ["b", "a", "b", " a ", "c"], "user-1"
        )

        # The list IS the order the card leads with, so dedup must not resort it.
        assert stored == ["b", "a", "c"]

    def test_blank_keys_are_dropped_rather_than_stored(self, markets):
        assert MarketsApi.save_review_highlights("market-123", ["", "  ", "a"], "user-1") == ["a"]

    def test_clearing_them_is_a_write_of_the_empty_list(self, markets):
        """Not a delete: the card then shows every answer, which is what absent means too.

        One shape for "nothing is marked" keeps `reviewAnswers` from having to tell them apart.
        """
        assert MarketsApi.save_review_highlights("market-123", [], "user-1") == []
        assert markets.last_update == {"$set": {"reviewHighlights": []}}

    def test_it_is_refused_to_anyone_below_editor(self, markets, monkeypatch):
        monkeypatch.setattr(
            PermissionsApi,
            "user_has_permission",
            lambda _user, _market, role, *_a, **_kw: role != MarketRole.EDITOR,
        )

        with pytest.raises(PermissionError):
            MarketsApi.save_review_highlights("market-123", ["a"], "user-1")

    def test_an_unknown_market_is_not_found(self, monkeypatch):
        monkeypatch.setattr(MarketsApi, "markets_collection", FakeMarketsCollection(None))

        with pytest.raises(MarketsApi.MarketNotFoundError):
            MarketsApi.save_review_highlights("market-123", ["a"], "user-1")

    def test_a_locked_form_does_NOT_lock_the_highlights(self, markets, monkeypatch):
        """The D9 lock freezes the form; it must not freeze these.

        An organizer finds out which answers they needed by reviewing real applications - which is
        only possible once applications exist, which is exactly when the form has frozen. A
        highlight that inherited that lock would be settable only before it was knowable. The
        market here is BOTH past draft and carrying applications, so either half of that lock
        would refuse this.
        """
        monkeypatch.setattr(
            MarketsApi.ApplicationsApi, "count_applications_for_market", lambda _id: 3
        )
        assert MarketsApi.application_form_lock_reason(
            MarketsApi.market_from_document(stored_market(MarketPhase.REVIEW))
        )

        assert MarketsApi.save_review_highlights("market-123", ["a"], "user-1") == ["a"]
