"""The applications collection and its indexes must reach already-deployed databases.

mongo-init.js only runs on a fresh data volume, so the D9 lock's per-market application count
would otherwise be an unindexed scan in production - and the applicant identity, which is what stops
one address from holding two applications, would not be enforced at all.
"""
import pytest

from create_applications_collection import DuplicateApplicantsError, migrate

from api.applications import (
    APPLICANT_EMAIL_FIELD,
    APPLICANT_IDENTITY_INDEX,
    APPLICATION_TYPE_FIELD,
    APPLICATIONS_COLLECTION,
    MARKET_ID_FIELD,
)

IDENTITY_INDEX = APPLICANT_IDENTITY_INDEX
MARKET_INDEX = f"{MARKET_ID_FIELD}_1"


def _application(market_id="market-1", email="vendor@example.com", app_type="main", app_id="app-1"):
    return {
        "id": app_id,
        MARKET_ID_FIELD: market_id,
        APPLICANT_EMAIL_FIELD: email,
        APPLICATION_TYPE_FIELD: app_type,
    }


class FakeCollection:
    def __init__(self, documents=()):
        self.indexes = []
        self.documents = list(documents)

    def create_index(self, keys, unique=False, name=None):
        index_name = name or "_".join(f"{field}_{direction}" for field, direction in keys)
        if index_name not in self.indexes:
            self.indexes.append(index_name)
        return index_name

    def aggregate(self, _pipeline):
        """The one pipeline the migration runs: group by applicant identity, keep the groups that
        hold more than one document."""
        groups = {}
        for doc in self.documents:
            key = (
                doc.get(MARKET_ID_FIELD),
                doc.get(APPLICANT_EMAIL_FIELD),
                doc.get(APPLICATION_TYPE_FIELD),
            )
            groups.setdefault(key, []).append(doc.get("id"))
        return [
            {
                "_id": {
                    MARKET_ID_FIELD: market_id,
                    APPLICANT_EMAIL_FIELD: email,
                    APPLICATION_TYPE_FIELD: app_type,
                },
                "ids": ids,
                "count": len(ids),
            }
            for (market_id, email, app_type), ids in groups.items()
            if len(ids) > 1
        ]


class FakeDatabase:
    def __init__(self, collections=(), applications=()):
        self.collections = {name: FakeCollection() for name in collections}
        if APPLICATIONS_COLLECTION in self.collections:
            self.collections[APPLICATIONS_COLLECTION] = FakeCollection(applications)

    def list_collection_names(self):
        return list(self.collections)

    def create_collection(self, name):
        assert name not in self.collections
        self.collections[name] = FakeCollection()

    def __getitem__(self, name):
        return self.collections.setdefault(name, FakeCollection())


def test_creates_the_collection_and_both_indexes():
    db = FakeDatabase(["markets"])

    migrate(db)

    assert APPLICATIONS_COLLECTION in db.list_collection_names()
    assert db[APPLICATIONS_COLLECTION].indexes == [MARKET_INDEX, IDENTITY_INDEX]


def test_indexes_a_collection_that_already_exists():
    db = FakeDatabase(["markets", APPLICATIONS_COLLECTION])

    migrate(db)

    assert db[APPLICATIONS_COLLECTION].indexes == [MARKET_INDEX, IDENTITY_INDEX]


def test_migration_is_idempotent():
    db = FakeDatabase(["markets"])

    migrate(db)
    migrate(db)

    assert db[APPLICATIONS_COLLECTION].indexes == [MARKET_INDEX, IDENTITY_INDEX]


def test_dry_run_writes_nothing():
    db = FakeDatabase(["markets"])

    migrate(db, dry_run=True)

    assert APPLICATIONS_COLLECTION not in db.list_collection_names()


def test_existing_duplicates_are_named_rather_than_indexed_over():
    """A unique index cannot be built over a duplicate, and which of the two documents is the
    applicant's is the organizer's call, not this script's. So it stops, and says which they are."""
    db = FakeDatabase(
        ["markets", APPLICATIONS_COLLECTION],
        applications=[
            _application(app_id="app-1"),
            _application(app_id="app-2"),
            _application(email="other@example.com", app_id="app-3"),
        ],
    )

    with pytest.raises(DuplicateApplicantsError) as exc:
        migrate(db)

    message = str(exc.value)
    assert "vendor@example.com" in message
    assert "app-1" in message and "app-2" in message
    assert "other@example.com" not in message
    assert IDENTITY_INDEX not in db[APPLICATIONS_COLLECTION].indexes


def test_a_dry_run_reports_the_duplicates_instead_of_raising(capsys):
    db = FakeDatabase(
        ["markets", APPLICATIONS_COLLECTION],
        applications=[_application(app_id="app-1"), _application(app_id="app-2")],
    )

    migrate(db, dry_run=True)

    assert "vendor@example.com" in capsys.readouterr().out


def test_one_application_of_each_type_is_not_a_duplicate():
    db = FakeDatabase(
        ["markets", APPLICATIONS_COLLECTION],
        applications=[
            _application(app_type="main", app_id="app-1"),
            _application(app_type="waitlist", app_id="app-2"),
        ],
    )

    migrate(db)

    assert db[APPLICATIONS_COLLECTION].indexes == [MARKET_INDEX, IDENTITY_INDEX]
