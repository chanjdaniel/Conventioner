"""Regression: the phase migration must read the camel-cased `isDraft` key markets are stored under."""
import copy
from types import SimpleNamespace

from migrate_phase import migrate


class FakeCollection:
    def __init__(self, docs):
        self.docs = docs

    def find(self, query):
        assert query == {"phase": {"$exists": False}}
        return [copy.deepcopy(doc) for doc in self.docs if "phase" not in doc]

    def update_many(self, query, update):
        ids = set(query["_id"]["$in"])
        phase = update["$set"]["phase"]
        modified = 0
        for doc in self.docs:
            if doc["_id"] in ids and doc.get("phase") != phase:
                doc["phase"] = phase
                modified += 1
        return SimpleNamespace(modified_count=modified)


class FakeDatabase:
    def __init__(self, docs):
        self.markets = FakeCollection(docs)


def phases(db):
    return {doc["id"]: doc.get("phase") for doc in db.markets.docs}


def test_published_camel_case_market_becomes_archived():
    db = FakeDatabase([{"_id": 1, "id": "m1", "isDraft": False}])
    migrate(db)
    assert phases(db) == {"m1": "archived"}


def test_draft_camel_case_market_becomes_draft():
    db = FakeDatabase([{"_id": 1, "id": "m1", "isDraft": True}])
    migrate(db)
    assert phases(db) == {"m1": "draft"}


def test_legacy_snake_case_market_is_honoured():
    db = FakeDatabase([{"_id": 1, "id": "m1", "is_draft": False}])
    migrate(db)
    assert phases(db) == {"m1": "archived"}


def test_market_without_draft_flag_defaults_to_draft():
    db = FakeDatabase([{"_id": 1, "id": "m1"}])
    migrate(db)
    assert phases(db) == {"m1": "draft"}


def test_mixed_markets_are_partitioned():
    db = FakeDatabase([
        {"_id": 1, "id": "published", "isDraft": False},
        {"_id": 2, "id": "drafted", "isDraft": True},
        {"_id": 3, "id": "legacy", "is_draft": False},
    ])
    migrate(db)
    assert phases(db) == {"published": "archived", "drafted": "draft", "legacy": "archived"}


def test_migration_is_idempotent_and_skips_existing_phase():
    db = FakeDatabase([
        {"_id": 1, "id": "m1", "isDraft": False},
        {"_id": 2, "id": "m2", "isDraft": False, "phase": "review"},
    ])
    migrate(db)
    migrate(db)
    assert phases(db) == {"m1": "archived", "m2": "review"}


def test_dry_run_writes_nothing():
    db = FakeDatabase([{"_id": 1, "id": "m1", "isDraft": False}])
    migrate(db, dry_run=True)
    assert phases(db) == {"m1": None}
