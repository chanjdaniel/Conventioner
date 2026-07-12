"""The applications collection and its market_id index must reach already-deployed databases.

mongo-init.js only runs on a fresh data volume, so the D9 lock's per-market application count
would otherwise be an unindexed scan in production.
"""
from create_applications_collection import migrate

from api.applications import APPLICATIONS_COLLECTION, MARKET_ID_FIELD


class FakeCollection:
    def __init__(self):
        self.indexes = []

    def create_index(self, keys):
        name = "_".join(f"{field}_{direction}" for field, direction in keys)
        if name not in self.indexes:
            self.indexes.append(name)
        return name


class FakeDatabase:
    def __init__(self, collections=()):
        self.collections = {name: FakeCollection() for name in collections}

    def list_collection_names(self):
        return list(self.collections)

    def create_collection(self, name):
        assert name not in self.collections
        self.collections[name] = FakeCollection()

    def __getitem__(self, name):
        return self.collections[name]


def test_creates_the_collection_and_its_market_id_index():
    db = FakeDatabase(["markets"])

    migrate(db)

    assert APPLICATIONS_COLLECTION in db.list_collection_names()
    assert db[APPLICATIONS_COLLECTION].indexes == [f"{MARKET_ID_FIELD}_1"]


def test_indexes_a_collection_that_already_exists():
    db = FakeDatabase(["markets", APPLICATIONS_COLLECTION])

    migrate(db)

    assert db[APPLICATIONS_COLLECTION].indexes == [f"{MARKET_ID_FIELD}_1"]


def test_migration_is_idempotent():
    db = FakeDatabase(["markets"])

    migrate(db)
    migrate(db)

    assert db[APPLICATIONS_COLLECTION].indexes == [f"{MARKET_ID_FIELD}_1"]


def test_dry_run_writes_nothing():
    db = FakeDatabase(["markets"])

    migrate(db, dry_run=True)

    assert APPLICATIONS_COLLECTION not in db.list_collection_names()
