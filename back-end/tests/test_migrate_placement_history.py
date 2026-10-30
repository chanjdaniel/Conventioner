"""The placement history moves into the market's history, every entry as it was (E40/F01/S01)."""
import copy

from conftest import mongo_matches

from migrate_placement_history import migrate_placement_history


class FakeCollection:
    def __init__(self, docs=None):
        self.docs = [copy.deepcopy(doc) for doc in docs or []]
        self.dropped = False

    def find(self, query=None, _projection=None):
        return [copy.deepcopy(doc) for doc in self.docs if mongo_matches(doc, query or {})]

    def count_documents(self, query):
        return len(self.find(query))

    def replace_one(self, query, document, upsert=False):
        for i, doc in enumerate(self.docs):
            if mongo_matches(doc, query):
                self.docs[i] = copy.deepcopy(document)
                return
        assert upsert
        self.docs.append(copy.deepcopy(document))

    def delete_many(self, query):
        ids = set(query["_id"]["$in"])
        self.docs = [doc for doc in self.docs if doc["_id"] not in ids]

    def drop(self):
        self.dropped = True
        self.docs = []


class FakeDatabase(dict):
    def __missing__(self, name):
        self[name] = FakeCollection()
        return self[name]


PLACED = {
    "_id": "oid-1", "id": "e1", "market_id": "m1", "actor": "dana@example.com",
    "at": "2026-10-01T10:00:00+00:00", "kind": "placed", "vendors": ["ana@example.com"],
    "detail": {"date": "2026-11-18", "table_code": "A 1", "table_choice": "Full Table"},
}
SWAPPED = {
    "_id": "oid-2", "id": "e2", "market_id": "m1", "actor": "dana@example.com",
    "at": "2026-10-02T10:00:00+00:00", "kind": "swapped",
    "vendors": ["ana@example.com", "ben@example.com"],
    "detail": {"date": "2026-11-18", "seats": [
        {"email": "ana@example.com", "table_code": "A 2"},
        {"email": "ben@example.com", "table_code": "A 1"},
    ]},
}
RUN = {
    "_id": "oid-3", "id": "e3", "market_id": "m2", "actor": "lee@example.com",
    "at": "2026-10-03T10:00:00+00:00", "kind": "assigned", "vendors": [],
    "detail": {"placements_written": 12, "pins_preserved": 2},
}


def a_database(*entries):
    db = FakeDatabase()
    db["placement_history"] = FakeCollection(entries)
    return db


def test_every_entry_moves_with_its_fields_unchanged():
    db = a_database(PLACED, SWAPPED, RUN)

    assert migrate_placement_history(db) == 3

    moved = {doc["id"]: doc for doc in db["history"].docs}
    for old in (PLACED, SWAPPED, RUN):
        assert {key: moved[old["id"]][key] for key in old} == old
    assert db["placement_history"].docs == []
    assert db["placement_history"].dropped


def test_each_entry_gains_the_action_and_what_it_is_about():
    db = a_database(PLACED, SWAPPED, RUN)

    migrate_placement_history(db)

    moved = {doc["id"]: doc for doc in db["history"].docs}
    assert {doc["action"] for doc in moved.values()} == {"assign"}
    assert moved["e1"]["subject"] == {"date": "2026-11-18", "table_codes": ["A 1"]}
    assert moved["e2"]["subject"] == {"date": "2026-11-18", "table_codes": ["A 2", "A 1"]}
    assert moved["e3"]["subject"] == {}


def test_a_dry_run_counts_and_writes_nothing():
    db = a_database(PLACED, SWAPPED)

    assert migrate_placement_history(db, dry_run=True) == 2

    assert db["history"].docs == []
    assert len(db["placement_history"].docs) == 2
    assert not db["placement_history"].dropped


def test_running_it_again_moves_only_what_arrived_since():
    """Idempotent: a run after the deploy picks up what the old build wrote meanwhile."""
    db = a_database(PLACED)
    migrate_placement_history(db)
    db["placement_history"] = FakeCollection([SWAPPED])

    assert migrate_placement_history(db) == 1

    assert sorted(doc["id"] for doc in db["history"].docs) == ["e1", "e2"]


def test_an_entry_already_in_the_history_is_not_doubled():
    """A run that stopped between writing and clearing leaves both; the next one keeps one."""
    db = a_database(PLACED)
    db["history"] = FakeCollection([{**PLACED, "action": "assign", "subject": {}}])

    migrate_placement_history(db)

    assert [doc["id"] for doc in db["history"].docs] == ["e1"]


def test_an_empty_placement_history_moves_nothing():
    db = a_database()

    assert migrate_placement_history(db) == 0
    assert db["history"].docs == []
