"""``market_write.write_market`` on the server: what a write holds, what it counts, and what it
answers when the market moved or is gone.

Each test stores a market, takes it as read, lets another write land on the server where a second
request would, and writes from the read. A held fact that moved stores nothing and raises
``MarketChanged`` with the market as it now stands.
"""
import copy
import uuid

import pytest

from conftest import stored_market
from datatypes import MarketPhase
from market_documents import market_from_document
from market_write import MarketChanged, MarketNotFoundError, Written, write_market

RENAME = {"$set": {"name": "Fixture Renamed"}}


@pytest.fixture
def markets(real_db):
    return real_db["markets"]


@pytest.fixture
def stored(markets):
    """``stored(phase, **fields)``: a market stored with a fresh id; returns it as read."""
    def store(phase=MarketPhase.DRAFT, **fields):
        document = stored_market(phase, id=str(uuid.uuid4()), **fields)
        markets.insert_one(copy.deepcopy(document))
        return markets.find_one({"id": document["id"]})

    return store


def _now(markets, as_read):
    return markets.find_one({"id": as_read["id"]})


def _refused(markets, as_read, update=RENAME, **holding):
    """Write from ``as_read`` and assert it was refused, storing nothing: the market as it stood."""
    before = _now(markets, as_read)
    with pytest.raises(MarketChanged) as changed:
        write_market(as_read, update, **holding)
    assert _now(markets, as_read) == before
    assert changed.value.latest == before
    return changed.value


class TestThePhaseIsAlwaysHeld:
    def test_a_write_over_the_phase_it_read_lands(self, markets, stored):
        as_read = stored(MarketPhase.DRAFT)

        assert write_market(as_read, RENAME) == Written({})

        assert _now(markets, as_read)["name"] == "Fixture Renamed"

    def test_a_write_over_a_market_that_moved_is_refused(self, markets, stored):
        as_read = stored(MarketPhase.DRAFT)
        markets.update_one({"id": as_read["id"]}, {"$set": {"phase": "applications"}})

        _refused(markets, as_read)

    def test_a_market_read_with_no_phase_is_held_at_none(self, markets, stored):
        as_read = stored(MarketPhase.DRAFT)
        markets.update_one({"id": as_read["id"]}, {"$unset": {"phase": ""}})
        as_read = _now(markets, as_read)

        write_market(as_read, RENAME)
        assert _now(markets, as_read)["name"] == "Fixture Renamed"

        markets.update_one({"id": as_read["id"]}, {"$set": {"phase": "draft"}})
        _refused(markets, as_read, {"$set": {"name": "Fixture Again"}})

    def test_the_id_is_held(self, markets, stored):
        """Another market in the same phase is never written."""
        as_read = stored(MarketPhase.DRAFT)
        other = stored(MarketPhase.DRAFT)

        write_market(as_read, RENAME)

        assert _now(markets, other)["name"] == other["name"]


class TestAHeldKey:
    def test_held_at_its_value_lands_while_it_stands(self, markets, stored):
        as_read = stored(MarketPhase.APPLICATIONS, intakeMode="form")

        write_market(as_read, RENAME, holds=["intakeMode"])

        assert _now(markets, as_read)["name"] == "Fixture Renamed"

    def test_held_at_its_value_is_refused_once_it_changed(self, markets, stored):
        as_read = stored(MarketPhase.APPLICATIONS, intakeMode="form")
        markets.update_one({"id": as_read["id"]}, {"$set": {"intakeMode": "csv"}})

        _refused(markets, as_read, holds=["intakeMode"])

    def test_a_key_not_held_may_change_under_the_write(self, markets, stored):
        as_read = stored(MarketPhase.APPLICATIONS, intakeMode="form")
        markets.update_one({"id": as_read["id"]}, {"$set": {"intakeMode": "csv"}})

        write_market(as_read, RENAME)

        assert _now(markets, as_read)["name"] == "Fixture Renamed"

    def test_a_held_sub_document_lands_while_it_stands(self, markets, stored):
        as_read = stored(MarketPhase.APPLICATIONS, permissions={
            "give-verdicts": {"role": "admin", "source": "market"}})

        write_market(as_read, RENAME, holds=["permissions"])

        assert _now(markets, as_read)["name"] == "Fixture Renamed"

    def test_a_held_sub_document_is_refused_once_a_field_inside_it_changed(self, markets, stored):
        as_read = stored(MarketPhase.APPLICATIONS, permissions={
            "give-verdicts": {"role": "admin", "source": "market"}})
        markets.update_one({"id": as_read["id"]},
                           {"$set": {"permissions.give-verdicts.role": "editor"}})

        _refused(markets, as_read, holds=["permissions"])

    def test_a_dotted_key_holds_that_part_only(self, markets, stored):
        as_read = stored(MarketPhase.APPLICATIONS, permissions={
            "give-verdicts": {"role": "admin", "source": "market"},
            "change-verdicts": {"role": "admin", "source": "market"}})
        markets.update_one({"id": as_read["id"]},
                           {"$set": {"permissions.change-verdicts.role": "editor"}})

        write_market(as_read, RENAME, holds=["permissions.give-verdicts"])
        assert _now(markets, as_read)["name"] == "Fixture Renamed"

        markets.update_one({"id": as_read["id"]},
                           {"$set": {"permissions.give-verdicts.role": "editor"}})
        _refused(markets, as_read, {"$set": {"name": "Fixture Again"}},
                 holds=["permissions.give-verdicts"])

    def test_a_key_read_absent_lands_while_it_stays_absent(self, markets, stored):
        as_read = stored(MarketPhase.APPLICATIONS)

        write_market(as_read, RENAME, holds=["importMapping", "applicationForm.essentialOptions"])

        assert _now(markets, as_read)["name"] == "Fixture Renamed"

    def test_a_key_read_absent_is_refused_once_it_was_written(self, markets, stored):
        as_read = stored(MarketPhase.APPLICATIONS, applicationForm={"fields": []})
        markets.update_one({"id": as_read["id"]},
                           {"$set": {"applicationForm.essentialOptions": {"dates": []}}})

        _refused(markets, as_read, holds=["applicationForm.essentialOptions"])

    def test_a_key_read_absent_is_refused_once_it_was_written_null(self, markets, stored):
        """Absent is held as absent, not as null: a write of null is a write."""
        as_read = stored(MarketPhase.APPLICATIONS)
        markets.update_one({"id": as_read["id"]}, {"$set": {"importMapping": None}})

        _refused(markets, as_read, holds=["importMapping"])

    def test_a_key_under_a_null_parent_reads_absent(self, markets, stored):
        as_read = stored(MarketPhase.APPLICATIONS, applicationForm=None)

        write_market(as_read, RENAME, holds=["applicationForm.essentialOptions"])

        assert _now(markets, as_read)["name"] == "Fixture Renamed"

    def test_a_null_held_matches_null_or_missing(self, markets, stored):
        as_read = stored(MarketPhase.APPLICATIONS, importMapping=None)
        markets.update_one({"id": as_read["id"]}, {"$unset": {"importMapping": ""}})

        write_market(as_read, RENAME, holds=["importMapping"])
        assert _now(markets, as_read)["name"] == "Fixture Renamed"

        markets.update_one({"id": as_read["id"]}, {"$set": {"importMapping": {"columns": []}}})
        _refused(markets, as_read, {"$set": {"name": "Fixture Again"}}, holds=["importMapping"])


class TestARevision:
    def test_held_at_0_on_a_market_that_never_stored_one_lands_and_counts_it(
            self, markets, stored):
        as_read = stored(MarketPhase.DRAFT)

        written = write_market(as_read, RENAME, revisions={"planRevision": 0})

        assert written == Written({"planRevision": 1})
        assert _now(markets, as_read)["planRevision"] == 1

    def test_held_at_none_reads_as_0(self, markets, stored):
        as_read = stored(MarketPhase.DRAFT, planRevision=0)

        assert write_market(as_read, RENAME, revisions={"planRevision": None}) == Written(
            {"planRevision": 1})

    def test_held_at_the_stored_revision_lands_and_counts_it(self, markets, stored):
        as_read = stored(MarketPhase.ASSIGNMENT, assignmentObject={"revision": 4})

        written = write_market(as_read, RENAME, revisions={"assignmentObject.revision": 4})

        assert written == Written({"assignmentObject.revision": 5})
        assert _now(markets, as_read)["assignmentObject"]["revision"] == 5

    def test_an_older_revision_is_refused(self, markets, stored):
        as_read = stored(MarketPhase.DRAFT, planRevision=3)

        _refused(markets, as_read, revisions={"planRevision": 2})

    def test_0_is_refused_once_a_revision_was_stored(self, markets, stored):
        as_read = stored(MarketPhase.DRAFT)
        write_market(as_read, RENAME, revisions={"planRevision": 0})

        _refused(markets, as_read, {"$set": {"name": "Fixture Again"}},
                 revisions={"planRevision": 0})

    def test_two_writes_from_one_revision_land_one(self, markets, stored):
        as_read = stored(MarketPhase.DRAFT, planRevision=1)
        write_market(as_read, RENAME, revisions={"planRevision": 1})

        _refused(markets, as_read, {"$set": {"name": "Fixture Again"}},
                 revisions={"planRevision": 1})

        assert _now(markets, as_read)["name"] == "Fixture Renamed"


class TestACount:
    def test_it_is_counted_up_and_not_held(self, markets, stored):
        as_read = stored(MarketPhase.DRAFT, formRevision=2)

        first = write_market(as_read, RENAME, counts=["formRevision", "planRevision"])
        second = write_market(as_read, {"$set": {"name": "Fixture Again"}},
                              counts=["formRevision", "planRevision"])

        assert first == Written({"formRevision": 3, "planRevision": 1})
        assert second == Written({"formRevision": 4, "planRevision": 2})

    def test_a_revision_and_a_count_answer_together(self, markets, stored):
        as_read = stored(MarketPhase.DRAFT, planRevision=1)

        written = write_market(as_read, RENAME, revisions={"planRevision": 1},
                               counts=["formRevision"])

        assert written == Written({"planRevision": 2, "formRevision": 1})

    def test_an_update_that_counts_a_counted_key_itself_is_refused(self, markets, stored):
        as_read = stored(MarketPhase.DRAFT)

        with pytest.raises(RuntimeError, match="planRevision"):
            write_market(as_read, {"$inc": {"planRevision": 1}}, counts=["planRevision"])

        assert "planRevision" not in _now(markets, as_read)


class TestTheMarketAsRead:
    def test_a_market_a_loader_parsed_is_held_at_its_stored_document(self, markets, stored):
        as_read = market_from_document(stored(MarketPhase.DRAFT))
        markets.update_one({"id": as_read.id}, {"$set": {"phase": "applications"}})

        with pytest.raises(MarketChanged):
            write_market(as_read, RENAME)

    def test_a_copy_of_it_holds_the_same_document(self, markets, stored):
        as_read = market_from_document(stored(MarketPhase.DRAFT)).model_copy(
            update={"name": "Elsewhere"})

        write_market(as_read, RENAME)

        assert _now(markets, {"id": as_read.id})["name"] == "Fixture Renamed"


class TestAMarketGoneInBetween:
    def test_answers_not_found(self, markets, stored):
        as_read = stored(MarketPhase.DRAFT)
        markets.delete_one({"id": as_read["id"]})

        with pytest.raises(MarketNotFoundError, match="Market not found"):
            write_market(as_read, RENAME)

        assert markets.count_documents({}) == 0
