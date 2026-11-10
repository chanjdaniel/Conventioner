"""The shared markets fakes write as MongoDB does: ``FakeMarketsCollection`` and
``FakeSlugMarketsCollection`` apply the filter an ``update_one`` is given and the update it
carries, and answer the server's matched and modified counts.

A market write that holds what it read (the phase move's stored phase, Publish results' phase) is
refused by the server when the stored market no longer holds it. A fake that answered every write
``matched_count=1`` and left its document alone let a test of such a write pass whether or not the
write would have landed, and let a test read a stored market no write had changed. The filter is
read by ``mongo_matches`` and the update applied by ``mongo_update``, both checked against the
server by ``tests/mongo_cases.py``'s tables; the update table runs through both markets fakes
here too, every case but the upserts, which no market write makes.
"""
import copy

import pytest

import api.markets as MarketsApi
from api.markets import PhaseChangedUnderRequest, apply_phase_transition
from conftest import (
    FakeMarketsCollection, FakeSlugMarketsCollection, UnmodelledQuery, stored_market,
)
from datatypes import MarketPhase
from mongo_cases import UPDATE_CASES, as_stored

MARKET_UPDATES = [case for case in UPDATE_CASES if not case.upsert]
ANSWERED = [case for case in MARKET_UPDATES if case.fake_refuses is None]
REFUSED = [case for case in MARKET_UPDATES if case.fake_refuses is not None]


def _fakes(doc):
    """Each shared markets fake holding ``doc``, the slug fake beside a market of another id."""
    return [
        FakeMarketsCollection(doc),
        FakeSlugMarketsCollection([stored_market(id="other-market", name="Other"), doc]),
    ]


def _stored(fake) -> dict:
    """The market ``market-123`` as the fake stores it."""
    if isinstance(fake, FakeMarketsCollection):
        return fake.doc
    return next(doc for doc in fake.docs if doc["id"] == "market-123")


FAKE_IDS = ["FakeMarketsCollection", "FakeSlugMarketsCollection"]


def _holding(make, document):
    """The fake ``make`` names, holding ``document`` (``None`` for nothing stored) alone."""
    document = copy.deepcopy(document)
    if make == 0:
        return FakeMarketsCollection(document)
    return FakeSlugMarketsCollection([] if document is None else [document])


def _held(fake) -> list:
    docs = [fake.doc] if isinstance(fake, FakeMarketsCollection) else fake.docs
    return [doc for doc in docs if doc is not None]


@pytest.mark.parametrize("make", [0, 1], ids=FAKE_IDS)
@pytest.mark.parametrize("case", ANSWERED, ids=[case.name for case in ANSWERED])
def test_an_update_case_answers_as_the_server(case, make):
    fake = _holding(make, case.document)

    result = fake.update_one(case.the_filter, case.update)

    assert (result.matched_count, result.modified_count) == (case.matched, case.modified)
    assert as_stored(_held(fake)) == as_stored([case.after])


@pytest.mark.parametrize("make", [0, 1], ids=FAKE_IDS)
@pytest.mark.parametrize("case", REFUSED, ids=[case.name for case in REFUSED])
def test_an_update_case_it_does_not_model_is_refused_and_stores_nothing(case, make):
    fake = _holding(make, case.document)

    with pytest.raises(UnmodelledQuery) as refused:
        fake.update_one(case.the_filter, case.update)

    assert case.fake_refuses in str(refused.value)
    assert as_stored(_held(fake)) == as_stored([case.document] if case.document else [])


class TestThePhaseMove:
    """The reproduction: the phase move holds the stored phase it read, so a move judged on a
    draft that another request already opened is refused, as the server refuses it."""

    def test_a_move_over_a_market_that_moved_on_is_refused(self, monkeypatch):
        as_read = stored_market(MarketPhase.DRAFT)
        fake = FakeMarketsCollection(stored_market(MarketPhase.APPLICATIONS))
        monkeypatch.setattr(MarketsApi, "markets_collection", fake)

        with pytest.raises(PhaseChangedUnderRequest):
            apply_phase_transition("market-123", as_read, MarketPhase.APPLICATIONS.value)

        assert fake.doc == stored_market(MarketPhase.APPLICATIONS)

    def test_a_move_over_the_market_as_read_lands(self, monkeypatch):
        as_read = stored_market(MarketPhase.DRAFT)
        fake = FakeMarketsCollection(stored_market(MarketPhase.DRAFT))
        monkeypatch.setattr(MarketsApi, "markets_collection", fake)

        apply_phase_transition("market-123", as_read, MarketPhase.APPLICATIONS.value, by="user-1")

        assert fake.doc["phase"] == MarketPhase.APPLICATIONS.value
        assert fake.doc["isDraft"] is False
        assert [entry["phase"] for entry in fake.doc["phaseHistory"]][-1] == "applications"
        assert as_read == stored_market(MarketPhase.DRAFT), "the caller's read is not the store"


@pytest.mark.parametrize("make", [0, 1], ids=FAKE_IDS)
class TestUpdateOne:
    def test_a_held_write_over_a_market_that_no_longer_holds_it_changes_nothing(self, make):
        fake = _fakes(stored_market(MarketPhase.APPLICATIONS))[make]

        result = fake.update_one({"id": "market-123", "phase": "draft"},
                                 {"$set": {"name": "Renamed"}})

        assert (result.matched_count, result.modified_count) == (0, 0)
        assert result.upserted_id is None
        assert _stored(fake) == stored_market(MarketPhase.APPLICATIONS)

    def test_a_write_that_matches_changes_the_stored_market(self, make):
        fake = _fakes(stored_market(MarketPhase.DRAFT))[make]

        result = fake.update_one(
            {"id": "market-123", "phase": "draft"},
            {"$set": {"name": "Renamed", "planObject.revision": 1},
             "$push": {"modificationList": "renamed"}})

        assert (result.matched_count, result.modified_count) == (1, 1)
        stored = _stored(fake)
        assert stored["name"] == "Renamed"
        assert stored["planObject"] == {"revision": 1}
        assert stored["modificationList"] == ["renamed"]

    def test_a_write_of_the_values_held_matches_and_modifies_nothing(self, make):
        fake = _fakes(stored_market(MarketPhase.DRAFT))[make]

        result = fake.update_one({"id": "market-123"}, {"$set": {"name": "Test Market"}})

        assert (result.matched_count, result.modified_count) == (1, 0)

    def test_a_write_by_another_id_leaves_the_market_alone(self, make):
        fake = _fakes(stored_market(MarketPhase.DRAFT))[make]

        result = fake.update_one({"id": "gone"}, {"$set": {"name": "Renamed"}})

        assert (result.matched_count, result.modified_count) == (0, 0)
        assert _stored(fake)["name"] == "Test Market"

    def test_the_update_document_is_kept_for_a_test_to_read(self, make):
        fake = _fakes(stored_market(MarketPhase.DRAFT))[make]
        update = {"$set": {"name": "Renamed"}}

        fake.update_one({"id": "market-123", "phase": "assignment"}, update)

        assert fake.last_update is update

    def test_a_malformed_update_is_refused(self, make):
        fake = _fakes(stored_market(MarketPhase.DRAFT))[make]

        with pytest.raises(ValueError):
            fake.update_one({"id": "market-123"}, {"$set": {"$set": {"name": "Renamed"}}})

    def test_an_unmodelled_filter_is_refused_though_nothing_matches(self, make):
        fake = _fakes(stored_market(MarketPhase.DRAFT))[make]

        with pytest.raises(UnmodelledQuery):
            fake.update_one({"id": "gone", "name": {"$regex": "^T"}}, {"$set": {"name": "x"}})

    def test_an_unmodelled_update_is_refused_though_nothing_matches(self, make):
        fake = _fakes(stored_market(MarketPhase.DRAFT))[make]

        with pytest.raises(UnmodelledQuery):
            fake.update_one({"id": "gone"}, {"$rename": {"name": "title"}})

    def test_a_read_hands_back_a_copy(self, make):
        fake = _fakes(stored_market(MarketPhase.DRAFT))[make]

        read = fake.find_one({"id": "market-123"})
        read["roles"]["user-2"] = "viewer"

        assert _stored(fake)["roles"] == {"user-1": "owner"}


class TestTheEmptyFake:
    def test_a_write_over_no_market_matches_nothing(self):
        fake = FakeMarketsCollection(None)

        result = fake.update_one({"id": "market-123"}, {"$set": {"name": "Renamed"}})

        assert (result.matched_count, result.modified_count) == (0, 0)
        assert fake.doc is None


class TestTheSlugFake:
    def test_a_write_changes_the_first_market_it_matches_only(self):
        first = stored_market(id="a", name="A")
        second = stored_market(id="b", name="B")
        fake = FakeSlugMarketsCollection([first, second])

        result = fake.update_one({"phase": "draft"}, {"$set": {"name": "Renamed"}})

        assert (result.matched_count, result.modified_count) == (1, 1)
        assert [doc["name"] for doc in fake.docs] == ["Renamed", "B"]
