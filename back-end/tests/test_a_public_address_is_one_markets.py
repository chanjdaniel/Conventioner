"""No two markets answer the same public address (E21/F03/S03).

A market's slug, derived from its name, is the unauthenticated address its applicant links and its
check-in page are served under. Uniqueness used to be checked on the exact NAME, and only at
creation, so both of these were accepted - reproduced on a running stack:

- renaming a market onto another market's exact name (200, and both then stored one slug);
- creating "Cafe Market" beside "Café Market", two names ``market_name_slug`` folds into one.

Either way a stranger following a public link could land on the wrong market.
"""
import pytest

from conftest import FakeSlugMarketsCollection, client_market, stored_market

import api.markets as MarketsApi
import api.permissions as PermissionsApi
from datatypes import Market
from market_documents import (
    MARKET_MIGRATION_IDS,
    MARKET_SLUG_INDEX,
    MARKETS_COLLECTION,
    SCHEMA_COLLECTION,
    MarketSlugCollisionError,
    apply_market_key_migration,
    ensure_market_slug_index,
)


def _market(name: str) -> Market:
    return Market(
        name=name,
        creation_date="2026-01-01T00:00:00Z",
        roles={"user-1": "owner"},
        modification_list=[],
        assignment_object={"vendorAssignments": [], "assignmentStatistics": None},
    )


@pytest.fixture
def two_markets(monkeypatch):
    collection = FakeSlugMarketsCollection(
        [
            stored_market(name="Café Market", id="market-cafe"),
            stored_market(name="Spring Market", id="market-123"),
        ]
    )
    monkeypatch.setattr(MarketsApi, "markets_collection", collection)
    monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_k: True)
    return collection


class TestCreation:
    def test_a_name_that_folds_onto_a_taken_address_is_refused(self, two_markets):
        with pytest.raises(ValueError, match="web address"):
            MarketsApi.create_market(_market("Cafe Market"), "owner@example.com")

    def test_the_same_name_is_refused(self, two_markets):
        with pytest.raises(ValueError, match="web address"):
            MarketsApi.create_market(_market("Spring Market"), "owner@example.com")

    def test_a_free_address_is_created(self, two_markets):
        MarketsApi.create_market(_market("Autumn Market"), "owner@example.com")


class TestRenaming:
    def test_a_rename_onto_another_markets_address_is_refused(self, two_markets):
        with pytest.raises(ValueError, match="web address"):
            MarketsApi.update_market("market-123", client_market(name="Cafe Market"), "user-1")

        assert two_markets.last_update is None

    def test_keeping_its_own_address_is_not_a_clash(self, two_markets):
        MarketsApi.update_market("market-123", client_market(name="Spring Market!"), "user-1")

        assert two_markets.last_update["$set"]["slug"] == "spring-market"


class FakeCollection:
    def __init__(self, docs):
        self.docs = docs
        self.indexes = {}
        self.dropped = []

    def find(self, query):
        assert query == {}
        return [dict(doc) for doc in self.docs]

    def replace_one(self, query, replacement):
        return type("R", (), {"modified_count": 0})()

    def index_information(self):
        return dict(self.indexes)

    def drop_index(self, name):
        self.dropped.append(name)
        self.indexes.pop(name, None)

    def create_index(self, keys, name=None, **options):
        self.indexes[name] = {"key": keys, **options}


class FakeSchemaCollection:
    def __init__(self):
        self.docs = {}

    def update_one(self, query, update, upsert=False):
        self.docs[query["_id"]] = update["$set"]


class FakeDatabase:
    def __init__(self, docs):
        self.collections = {
            MARKETS_COLLECTION: FakeCollection(docs),
            SCHEMA_COLLECTION: FakeSchemaCollection(),
        }

    def __getitem__(self, name):
        return self.collections[name]


class TestTheIndex:
    def test_the_slug_index_is_unique_over_every_real_address(self):
        db = FakeDatabase([stored_market(name="Spring Market", id="m1")])

        ensure_market_slug_index(db)

        index = db[MARKETS_COLLECTION].indexes[MARKET_SLUG_INDEX]
        assert index["unique"] is True
        # A name with nothing sluggable in it has no public address, and many markets may share
        # that absence - so the empty slug is outside the index rather than one address they clash on.
        assert index["partialFilterExpression"] == {"slug": {"$gt": ""}}

    def test_an_older_non_unique_index_is_replaced(self):
        db = FakeDatabase([])
        db[MARKETS_COLLECTION].indexes[MARKET_SLUG_INDEX] = {"key": [("slug", 1)]}

        ensure_market_slug_index(db)

        assert db[MARKETS_COLLECTION].dropped == [MARKET_SLUG_INDEX]
        assert db[MARKETS_COLLECTION].indexes[MARKET_SLUG_INDEX]["unique"] is True

    def test_markets_already_sharing_an_address_stop_the_migration_and_are_named(self):
        db = FakeDatabase(
            [
                stored_market(name="Café Market", id="m1"),
                stored_market(name="Cafe Market", id="m2"),
                stored_market(name="Spring Market", id="m3"),
            ]
        )

        with pytest.raises(MarketSlugCollisionError) as refused:
            apply_market_key_migration(db)

        assert "cafe-market" in str(refused.value)
        assert "Café Market" in str(refused.value) and "Cafe Market" in str(refused.value)
        assert "Spring Market" not in str(refused.value)
        assert db[SCHEMA_COLLECTION].docs == {}, "a marker was recorded over a collision"
        assert MARKET_SLUG_INDEX not in db[MARKETS_COLLECTION].indexes

    def test_the_unique_address_is_its_own_marker(self):
        """A database migrated before this existed must be refused until it is migrated again."""
        assert "market_slugs_unique" in MARKET_MIGRATION_IDS


def test_a_dry_run_names_the_clashes_without_stopping(capsys):
    from migrate_market_keys import migrate

    db = FakeDatabase(
        [stored_market(name="Café Market", id="m1"), stored_market(name="Cafe Market", id="m2")]
    )

    migrate(db, dry_run=True)

    out = capsys.readouterr().out
    assert "/cafe-market is shared by 'Café Market', 'Cafe Market'" in out
    assert db[SCHEMA_COLLECTION].docs == {}
