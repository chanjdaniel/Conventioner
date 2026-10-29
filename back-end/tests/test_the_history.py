"""The market's history: one store every change records through (E40/F01/S01).

The placement history widened (Daniel, Q23: "every change is logged"): an entry names the market,
who, when, the ``E39`` action and the finer kind, the vendors and whatever else it is about, and a
structured detail. The placement endpoint reads the same store narrowed to placements.
"""
import pytest

from conftest import mongo_matches, mongo_project

import api.market_actions as Actions
import history as History


class FakeHistoryCollection:
    """The ``history`` collection: Mongo's filter, with an array field matched by membership."""

    def __init__(self):
        self.docs = []

    def insert_one(self, document):
        self.docs.append(document)

    def _matches(self, doc, query):
        for key, condition in query.items():
            value = doc.get(key)
            if isinstance(value, list) and not isinstance(condition, dict):
                if condition not in value:
                    return False
            elif not mongo_matches(doc, {key: condition}):
                return False
        return True

    def find(self, query, projection=None):
        found = [doc for doc in self.docs if self._matches(doc, query)]
        return [mongo_project(dict(doc), projection) for doc in found]

    def delete_many(self, query):
        gone = [doc for doc in self.docs if self._matches(doc, query)]
        self.docs = [doc for doc in self.docs if doc not in gone]
        return type("R", (), {"deleted_count": len(gone)})()


@pytest.fixture
def history(monkeypatch):
    fake = FakeHistoryCollection()
    monkeypatch.setattr(History, "history_collection", fake)
    monkeypatch.setattr(History, "legacy_placement_collection", FakeHistoryCollection())
    return fake


@pytest.fixture
def placement_history(monkeypatch):
    """The old ``placement_history`` collection, on a database the migration has not moved yet."""
    fake = FakeHistoryCollection()
    monkeypatch.setattr(History, "legacy_placement_collection", fake)
    return fake


class TestAnEntry:
    def test_it_names_the_market_who_when_the_action_and_what_it_was_about(self, history):
        History.record(
            "m1", "dana@example.com", Actions.GIVE_VERDICTS, kind="verdict",
            vendors=["Ana@Example.com"], subject={"application_id": "app-1"},
            detail={"before": {"status": "pending"}, "after": {"status": "approved"}},
        )

        [entry] = history.docs
        assert entry["id"]
        assert entry["market_id"] == "m1"
        assert entry["actor"] == "dana@example.com"
        assert entry["at"]
        assert entry["action"] == "give-verdicts"
        assert entry["kind"] == "verdict"
        assert entry["vendors"] == ["ana@example.com"]
        assert entry["subject"] == {"application_id": "app-1"}
        assert entry["detail"] == {
            "before": {"status": "pending"}, "after": {"status": "approved"},
        }

    def test_an_action_with_one_change_needs_no_finer_kind(self, history):
        History.record("m1", "dana@example.com", Actions.CHANGE_SETUP)

        [entry] = history.docs
        assert entry["action"] == "change-setup"
        assert entry["kind"] is None
        assert entry["vendors"] == []
        assert entry["subject"] == {}
        assert entry["detail"] == {}

    def test_a_write_that_cannot_be_saved_is_swallowed(self, monkeypatch):
        """The change has landed by the time it is recorded; saying it failed would be a lie."""
        class Broken:
            def insert_one(self, _doc):
                raise RuntimeError("mongo is having a day")

        monkeypatch.setattr(History, "history_collection", Broken())

        History.record("m1", "dana@example.com", Actions.CHANGE_SETUP)


class TestAPlacementEntry:
    def test_it_is_an_assign_action_about_its_table_day(self, history):
        History.record_freed("m1", "dana@example.com", "ana@example.com", "2026-08-01", "A 1")

        [entry] = history.docs
        assert entry["action"] == Actions.ASSIGN.id
        assert entry["kind"] == History.FREED
        assert entry["subject"] == {"date": "2026-08-01", "table_codes": ["A 1"]}
        assert entry["detail"] == {"date": "2026-08-01", "table_code": "A 1"}

    def test_a_swap_is_about_both_tables(self, history):
        class Seat:
            def __init__(self, email, table_code):
                self.email, self.table_code = email, table_code

        History.record_swapped(
            "m1", "dana@example.com", "2026-08-01", Seat("a@x.test", "A 1"), Seat("b@x.test", "A 2"),
        )

        assert history.docs[0]["subject"] == {"date": "2026-08-01", "table_codes": ["A 1", "A 2"]}

    def test_a_run_is_about_the_whole_market(self, history):
        History.record_assignment_run("m1", "dana@example.com", 3, 1)

        [entry] = history.docs
        assert entry["kind"] == History.ASSIGNED
        assert entry["vendors"] == []
        assert entry["subject"] == {}


class TestThePlacementView:
    """The placement endpoint and the drawer's History tab answer as they did before the widening."""

    def test_it_holds_only_placements(self, history):
        History.record_freed("m1", "a@x.test", "v@x.test", "2026-08-01", "A 1")
        History.record("m1", "a@x.test", Actions.CHECK_IN, vendors=["v@x.test"])
        History.record("m1", "a@x.test", Actions.ASSIGN, kind="rules-changed")

        assert [e["kind"] for e in History.placement_entries("m1")] == [History.FREED]

    def test_an_entry_carries_the_fields_it_always_did_and_no_others(self, history):
        History.record_freed("m1", "a@x.test", "v@x.test", "2026-08-01", "A 1")

        [entry] = History.placement_entries("m1")
        assert set(entry) == {"id", "market_id", "actor", "at", "kind", "vendors", "detail"}

    def test_a_vendor_reads_only_their_placements(self, history):
        History.record_freed("m1", "a@x.test", "v@x.test", "2026-08-01", "A 1")
        History.record_freed("m1", "a@x.test", "w@x.test", "2026-08-01", "A 2")
        History.record_assignment_run("m1", "a@x.test", 2, 0)

        assert [e["vendors"] for e in History.placement_entries("m1", "W@x.test")] == [
            ["w@x.test"],
        ]


class TestThePlacementViewBeforeTheMigration:
    """Until ``migrate_placement_history.py`` runs, the older entries are still in
    ``placement_history``, without ``action`` or ``subject``, and the trail reads them as before."""

    def old_entry(self, market_id, at, table_code, vendor="v@x.test"):
        return {
            "_id": f"oid-{table_code}", "id": f"old-{table_code}", "market_id": market_id,
            "actor": "a@x.test", "at": at, "kind": History.FREED, "vendors": [vendor],
            "detail": {"date": "2026-08-01", "table_code": table_code},
        }

    def test_both_stores_answer_newest_first_in_the_old_shape(self, history, placement_history):
        placement_history.insert_one(self.old_entry("m1", "2026-01-01T00:00:00+00:00", "Old 1"))
        placement_history.insert_one(self.old_entry("m1", "2026-03-01T00:00:00+00:00", "Old 2"))
        placement_history.insert_one(self.old_entry("m2", "2026-02-01T00:00:00+00:00", "Other"))
        History.record_freed("m1", "a@x.test", "v@x.test", "2026-08-01", "New 1")
        history.docs[0]["at"] = "2026-02-01T00:00:00+00:00"

        entries = History.placement_entries("m1")

        assert [e["detail"]["table_code"] for e in entries] == ["Old 2", "New 1", "Old 1"]
        assert all(
            set(e) == {"id", "market_id", "actor", "at", "kind", "vendors", "detail"}
            for e in entries
        )

    def test_an_entry_in_both_stores_is_listed_once(self, history, placement_history):
        """A migration stopped between its writes and its delete leaves an entry in both."""
        old = self.old_entry("m1", "2026-01-01T00:00:00+00:00", "A 1")
        placement_history.insert_one(old)
        history.insert_one({**old, "action": Actions.ASSIGN.id, "subject": {}})

        assert [e["id"] for e in History.placement_entries("m1")] == ["old-A 1"]

    def test_a_vendor_reads_their_old_entries_too(self, history, placement_history):
        placement_history.insert_one(self.old_entry("m1", "2026-01-01T00:00:00+00:00", "A 1"))
        placement_history.insert_one(
            self.old_entry("m1", "2026-01-02T00:00:00+00:00", "A 2", vendor="w@x.test")
        )

        assert [e["vendors"] for e in History.placement_entries("m1", "W@x.test")] == [
            ["w@x.test"],
        ]

    def test_deleting_a_market_takes_its_unmoved_entries_too(self, history, placement_history):
        placement_history.insert_one(self.old_entry("m1", "2026-01-01T00:00:00+00:00", "A 1"))
        placement_history.insert_one(self.old_entry("m2", "2026-01-01T00:00:00+00:00", "A 2"))
        History.record_freed("m1", "a@x.test", "v@x.test", "2026-08-01", "A 3")

        assert History.delete_for_market("m1") == 2
        assert [e["market_id"] for e in placement_history.docs] == ["m2"]


def test_deleting_a_market_takes_every_entry_of_its_history(history):
    History.record("m1", "a@x.test", Actions.CHANGE_SETUP)
    History.record_freed("m1", "a@x.test", "v@x.test", "2026-08-01", "A 1")
    History.record("m2", "a@x.test", Actions.CHANGE_SETUP)

    assert History.delete_for_market("m1") == 2
    assert History.delete_for_market("m2") == 1
