"""``market_write`` without a server: the market a write holds, what it refuses to write from, and
the 409 a client reads. What a write holds on the server: ``tests/real_mongo/test_the_market_write.py``.
"""
import pytest

import market_write as MarketWrite
from client_errors import ConflictError
from conftest import FakeMarketsCollection, client_market, stored_market
from datatypes import MarketPhase
from market_documents import market_from_document
from market_write import MARKET_CHANGED, MarketChanged, write_market


@pytest.fixture
def markets(monkeypatch):
    fake = FakeMarketsCollection(stored_market(MarketPhase.DRAFT))
    monkeypatch.setattr(MarketWrite, "markets_collection", fake)
    return fake


class TestAMarketKeepsTheDocumentItWasReadFrom:
    def test_market_from_document_keeps_it(self):
        document = stored_market(MarketPhase.APPLICATIONS)

        assert market_from_document(document)._stored_document is document

    def test_a_copy_carries_it(self):
        document = stored_market(MarketPhase.APPLICATIONS)

        copied = market_from_document(document).model_copy(update={"name": "Elsewhere"})

        assert copied._stored_document is document

    def test_it_is_never_dumped(self):
        market = market_from_document(stored_market(MarketPhase.APPLICATIONS))

        assert "_stored_document" not in market.model_dump()
        assert "stored_document" not in market.model_dump_json()

    def test_a_market_built_in_code_has_none(self):
        assert client_market()._stored_document is None


class TestWhatAWriteWillNotWriteFrom:
    def test_a_market_built_in_code(self, markets):
        with pytest.raises(RuntimeError, match="no stored document"):
            write_market(client_market(), {"$set": {"name": "Renamed"}})

        assert markets.last_update is None

    def test_a_held_path_through_a_list(self, markets):
        as_read = stored_market(MarketPhase.DRAFT, rows=[{"e": 1}])

        with pytest.raises(RuntimeError, match="runs through a list"):
            write_market(as_read, {"$set": {"name": "Renamed"}}, holds=["rows.e"])

        assert markets.last_update is None


class TestTheAnswer:
    def test_a_write_over_the_market_as_read_lands(self, markets):
        write_market(market_from_document(stored_market(MarketPhase.DRAFT)),
                     {"$set": {"name": "Renamed"}})

        assert markets.doc["name"] == "Renamed"

    def test_a_write_over_a_market_that_moved_raises_market_changed(self, markets):
        markets.doc = stored_market(MarketPhase.APPLICATIONS)

        with pytest.raises(MarketChanged) as changed:
            write_market(stored_market(MarketPhase.DRAFT), {"$set": {"name": "Renamed"}})

        assert changed.value.latest == stored_market(MarketPhase.APPLICATIONS)
        assert markets.doc == stored_market(MarketPhase.APPLICATIONS)

    def test_market_changed_is_a_409_with_the_one_sentence_and_its_code(self):
        changed = MarketChanged(stored_market(MarketPhase.APPLICATIONS))

        assert isinstance(changed, ConflictError) and changed.status == 409
        assert changed.body() == {"error": MARKET_CHANGED, "code": "market_changed"}

    def test_the_sentence(self):
        assert MARKET_CHANGED == (
            "This market changed while you were working on it, so your change was not saved. "
            "Reload to see the latest, then make your change again.")
