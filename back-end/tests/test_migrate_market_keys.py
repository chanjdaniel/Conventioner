"""The key migration must leave every market under exactly one spelling of each field.

A document that carries both spellings keeps a snake_case value no write path ever refreshes,
so whichever reader still matches it acts on stale data. camelCase is the canonical spelling
and the one the last write set, so it wins.
"""
import copy
from types import SimpleNamespace

import pytest

from market_documents import (
    MARKETS_COLLECTION,
    MARKET_KEY_MIGRATION_ID,
    MONGO_ID_KEY,
    SCHEMA_COLLECTION,
    MarketKeyMigrationMissingError,
    assert_market_key_migration_recorded,
)
from migrate_market_keys import migrate


class FakeCollection:
    def __init__(self, docs):
        self.docs = docs

    def find(self, query):
        assert query == {}
        return [copy.deepcopy(doc) for doc in self.docs]

    def replace_one(self, query, replacement):
        for index, doc in enumerate(self.docs):
            if doc[MONGO_ID_KEY] == query[MONGO_ID_KEY]:
                modified = doc != replacement
                self.docs[index] = replacement
                return SimpleNamespace(modified_count=1 if modified else 0)
        return SimpleNamespace(modified_count=0)


class FakeSchemaCollection:
    def __init__(self):
        self.docs = {}

    def find_one(self, query):
        return self.docs.get(query[MONGO_ID_KEY])

    def update_one(self, query, update, upsert=False):
        doc = self.docs.get(query[MONGO_ID_KEY])
        if doc is None:
            if not upsert:
                return SimpleNamespace(matched_count=0)
            doc = dict(query)
            self.docs[query[MONGO_ID_KEY]] = doc
        doc.update(update.get("$set", {}))
        return SimpleNamespace(matched_count=1)


class FakeDatabase:
    def __init__(self, docs):
        self.collections = {
            MARKETS_COLLECTION: FakeCollection(docs),
            SCHEMA_COLLECTION: FakeSchemaCollection(),
        }

    def __getitem__(self, name):
        return self.collections[name]


def only(db):
    return db[MARKETS_COLLECTION].docs[0]


def test_legacy_keys_are_rewritten_under_the_canonical_spelling():
    db = FakeDatabase([{"_id": 1, "id": "m1", "organization_id": "org-a", "is_draft": False}])

    migrate(db)

    assert only(db) == {"_id": 1, "id": "m1", "organizationId": "org-a", "isDraft": False}


def test_stale_legacy_key_loses_to_the_canonical_one():
    db = FakeDatabase([
        {"_id": 1, "id": "m1", "organization_id": "org-a", "organizationId": "org-b"},
    ])

    migrate(db)

    assert only(db) == {"_id": 1, "id": "m1", "organizationId": "org-b"}


def test_nested_legacy_keys_are_rewritten_too():
    db = FakeDatabase([
        {"_id": 1, "id": "m1", "setup_object": {"col_names": ["a"], "num_tables": 2}},
    ])

    migrate(db)

    assert only(db) == {"_id": 1, "id": "m1", "setupObject": {"colNames": ["a"], "numTables": 2}}


def test_canonical_market_is_left_alone():
    db = FakeDatabase([{"_id": 1, "id": "m1", "organizationId": "org-a", "isDraft": True}])

    migrate(db)

    assert only(db) == {"_id": 1, "id": "m1", "organizationId": "org-a", "isDraft": True}


def test_migration_is_idempotent():
    db = FakeDatabase([{"_id": 1, "id": "m1", "organization_id": "org-a"}])

    migrate(db)
    migrate(db)

    assert only(db) == {"_id": 1, "id": "m1", "organizationId": "org-a"}


def test_dry_run_writes_nothing():
    db = FakeDatabase([{"_id": 1, "id": "m1", "organization_id": "org-a"}])

    migrate(db, dry_run=True)

    assert only(db) == {"_id": 1, "id": "m1", "organization_id": "org-a"}


def test_dry_run_records_no_marker():
    """A preview must not tell the app the database is safe to serve."""
    db = FakeDatabase([{"_id": 1, "id": "m1", "organization_id": "org-a"}])

    migrate(db, dry_run=True)

    with pytest.raises(MarketKeyMigrationMissingError):
        assert_market_key_migration_recorded(db)


def test_migration_records_the_marker():
    db = FakeDatabase([{"_id": 1, "id": "m1", "organization_id": "org-a"}])

    migrate(db)

    marker = db[SCHEMA_COLLECTION].find_one({MONGO_ID_KEY: MARKET_KEY_MIGRATION_ID})
    assert marker is not None
    assert marker["appliedAt"]


def test_marker_is_recorded_even_when_nothing_needs_rewriting():
    """A database that is already canonical still has to be able to boot."""
    db = FakeDatabase([{"_id": 1, "id": "m1", "organizationId": "org-a"}])

    migrate(db)

    assert_market_key_migration_recorded(db)
