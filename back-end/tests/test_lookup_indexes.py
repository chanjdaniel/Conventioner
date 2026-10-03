"""Every field a document is looked up by is indexed, on every database, not only on old ones.

The ids of markets, organizations and users were indexed only where ``migrate_to_uuid`` had run, so
every database created since scanned whole collections for its most common reads; a 314-row import
took 12 seconds against 25,000 applications.
"""
from lookup_indexes import LOOKUP_INDEXES, ensure_lookup_indexes


class _Collection:
    def __init__(self, existing=None):
        # name -> index_information() entry, as pymongo reports it
        self.indexes = {"_id_": {"key": [("_id", 1)]}}
        for name, fields, unique in existing or []:
            self.indexes[name] = {"key": [(field, 1) for field in fields], "unique": unique}
        self.created = []

    def index_information(self):
        return dict(self.indexes)

    def create_index(self, keys, **options):
        name = "_".join(f"{field}_{direction}" for field, direction in keys)
        assert name not in self.indexes, f"{name} asked for twice"
        self.indexes[name] = {"key": list(keys), **options}
        self.created.append(tuple(field for field, _ in keys))
        return name


class _Database(dict):
    def __missing__(self, name):
        self[name] = _Collection()
        return self[name]


def test_a_fresh_database_gets_every_lookup_index():
    db = _Database()

    built = ensure_lookup_indexes(db)

    for collection, indexes in LOOKUP_INDEXES.items():
        assert db[collection].created == indexes
    assert len(built) == sum(len(indexes) for indexes in LOOKUP_INDEXES.values())


def test_the_ids_every_screen_reads_by_are_among_them():
    assert ("id",) in LOOKUP_INDEXES["markets"]
    assert ("id",) in LOOKUP_INDEXES["applications"]
    assert ("id",) in LOOKUP_INDEXES["organizations"]
    assert ("email",) in LOOKUP_INDEXES["users"]
    assert ("market_id",) in LOOKUP_INDEXES["placement_history"]


def test_an_index_already_on_the_same_fields_is_left_alone_whatever_its_options():
    """A migrated database holds a unique ``id_1``; asking for a plain one beside it would be
    refused by Mongo as a conflicting index, and would fail the boot."""
    db = _Database()
    db["markets"] = _Collection(existing=[("id_1", ("id",), True)])

    ensure_lookup_indexes(db)

    assert ("id",) not in db["markets"].created
    assert db["markets"].indexes["id_1"]["unique"] is True


def test_a_second_boot_builds_nothing():
    db = _Database()
    ensure_lookup_indexes(db)

    assert ensure_lookup_indexes(db) == []
