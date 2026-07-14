"""The migration must leave every market in canonical form.

Two things make a market document canonical, and one rewrite establishes both.

A document that carries both spellings of a field keeps a snake_case value no write path ever
refreshes, so whichever reader still matches it acts on stale data. camelCase is the canonical
spelling and the one the last write set, so it wins.

And every market carries the slug of its name, because that is what the public lookup queries and
what the index is on. A market without one is reachable at no public URL at all, which is what the
markers -- and the boot check that reads them -- exist to make impossible to deploy.
"""
import copy
from types import SimpleNamespace

import pytest

from market_documents import (
    MARKETS_COLLECTION,
    MARKET_KEY_MIGRATION_ID,
    MARKET_SLUG_INDEX,
    MARKET_SLUG_MIGRATION_ID,
    MONGO_ID_KEY,
    SCHEMA_COLLECTION,
    MarketKeyMigrationMissingError,
    assert_market_key_migration_recorded,
)
from migrate_market_keys import migrate


class FakeCollection:
    def __init__(self, docs):
        self.docs = docs
        self.indexes = []

    def find(self, query):
        assert query == {}
        return [copy.deepcopy(doc) for doc in self.docs]

    def create_index(self, keys, name=None, **_kwargs):
        self.indexes.append((keys, name))

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

    assert only(db) == {
        "_id": 1, "id": "m1", "organizationId": "org-a", "isDraft": False, "slug": "",
    }


def test_stale_legacy_key_loses_to_the_canonical_one():
    db = FakeDatabase([
        {"_id": 1, "id": "m1", "organization_id": "org-a", "organizationId": "org-b"},
    ])

    migrate(db)

    assert only(db) == {"_id": 1, "id": "m1", "organizationId": "org-b", "slug": ""}


def test_nested_legacy_keys_are_rewritten_too():
    db = FakeDatabase([
        {"_id": 1, "id": "m1", "setup_object": {"col_names": ["a"], "num_tables": 2}},
    ])

    migrate(db)

    assert only(db) == {
        "_id": 1, "id": "m1", "setupObject": {"colNames": ["a"], "numTables": 2}, "slug": "",
    }


def test_canonical_market_is_left_alone():
    db = FakeDatabase([
        {"_id": 1, "id": "m1", "name": "Spring Market", "organizationId": "org-a",
         "isDraft": True, "slug": "spring-market"},
    ])

    migrate(db)

    assert only(db) == {
        "_id": 1, "id": "m1", "name": "Spring Market", "organizationId": "org-a",
        "isDraft": True, "slug": "spring-market",
    }


def test_migration_is_idempotent():
    db = FakeDatabase([{"_id": 1, "id": "m1", "organization_id": "org-a"}])

    migrate(db)
    migrate(db)

    assert only(db) == {"_id": 1, "id": "m1", "organizationId": "org-a", "slug": ""}


def test_dry_run_writes_nothing():
    db = FakeDatabase([{"_id": 1, "id": "m1", "organization_id": "org-a"}])

    migrate(db, dry_run=True)

    assert only(db) == {"_id": 1, "id": "m1", "organization_id": "org-a"}


class TestSlugBackfill:
    """Every public URL a market appears on resolves it by the stored slug, so a market without
    one is reachable at no public URL at all -- and the lookup that reads it is unauthenticated,
    which is why it must be an indexed query rather than a decode of every market."""

    def test_a_market_written_before_the_field_existed_is_given_its_slug(self):
        db = FakeDatabase([{"_id": 1, "id": "m1", "name": "Café Market"}])

        migrate(db)

        assert only(db)["slug"] == "cafe-market"

    def test_a_stored_slug_out_of_step_with_the_name_is_repaired(self):
        """The slug is derived, never carried over: nothing may leave it contradicting the name."""
        db = FakeDatabase([{"_id": 1, "id": "m1", "name": "Spring Market", "slug": "stale-slug"}])

        migrate(db)

        assert only(db)["slug"] == "spring-market"

    def test_the_slug_is_indexed(self):
        db = FakeDatabase([{"_id": 1, "id": "m1", "name": "Spring Market"}])

        migrate(db)

        assert db[MARKETS_COLLECTION].indexes == [("slug", MARKET_SLUG_INDEX)]

    def test_dry_run_builds_no_index(self):
        db = FakeDatabase([{"_id": 1, "id": "m1", "name": "Spring Market"}])

        migrate(db, dry_run=True)

        assert db[MARKETS_COLLECTION].indexes == []


def test_dry_run_records_no_marker():
    """A preview must not tell the app the database is safe to serve."""
    db = FakeDatabase([{"_id": 1, "id": "m1", "organization_id": "org-a"}])

    migrate(db, dry_run=True)

    with pytest.raises(MarketKeyMigrationMissingError):
        assert_market_key_migration_recorded(db)


def test_a_database_migrated_by_an_older_build_still_refuses_to_serve():
    """The older build recorded the key marker and knew nothing about slugs, so its markets have
    none -- and a market with no slug is on no public URL. The refusal is what catches that, and
    the one command that clears it is the same one."""
    db = FakeDatabase([{"_id": 1, "id": "m1", "name": "Spring Market"}])
    db[SCHEMA_COLLECTION].update_one(
        {MONGO_ID_KEY: MARKET_KEY_MIGRATION_ID}, {"$set": {"appliedAt": "then"}}, upsert=True,
    )

    with pytest.raises(MarketKeyMigrationMissingError) as excinfo:
        assert_market_key_migration_recorded(db)

    assert excinfo.value.missing == (MARKET_SLUG_MIGRATION_ID,)

    migrate(db)

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
