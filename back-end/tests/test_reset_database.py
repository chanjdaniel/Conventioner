"""The test-database reset clears every collection the application writes.

Its list is hand-kept, and it fell behind twice: once leaving applications and check-ins behind
every "clean" database, and again leaving the placement trail and the deletion records, which
then pointed at markets that no longer existed.
"""
from api.applicant_auth import APPLICANT_LOGIN_CHALLENGES_COLLECTION
from lookup_indexes import LOOKUP_INDEXES
from reset_database import APP_COLLECTIONS, PRESERVED


def test_every_collection_the_app_looks_documents_up_in_is_cleared():
    assert set(LOOKUP_INDEXES) <= set(APP_COLLECTIONS)


def test_applicant_sign_in_codes_are_cleared():
    assert APPLICANT_LOGIN_CHALLENGES_COLLECTION in APP_COLLECTIONS


def test_the_migration_markers_the_back_end_needs_to_boot_are_kept():
    assert "schema_migrations" in PRESERVED
    assert "schema_migrations" not in APP_COLLECTIONS


class _Collection:
    def __init__(self, log, name):
        self.log, self.name = log, name

    def delete_many(self, _filter):
        self.log.append(self.name)
        from types import SimpleNamespace
        return SimpleNamespace(deleted_count=0)

    def count_documents(self, _filter):
        return 0


class _Database:
    def __init__(self):
        self.deleted = []

    def list_collection_names(self):
        return []

    def __getitem__(self, name):
        return _Collection(self.deleted, name)


def test_a_hosted_database_is_never_reset(monkeypatch):
    # Production is reached by MONGODB_URI (Atlas); the local stack and CI by MONGODB_HOST. With
    # the production URI in a shell, this script would have erased the real market.
    import reset_database as Reset

    database = _Database()
    monkeypatch.setattr(Reset, "get_database", lambda: database)
    monkeypatch.setenv("MONGODB_URI", "mongodb+srv://someone:secret@cluster.example.net")

    import pytest

    with pytest.raises(SystemExit) as refused:
        Reset.reset_database()
    assert "MONGODB_URI" in str(refused.value)
    assert database.deleted == []


def test_the_local_stack_database_is_reset(monkeypatch):
    import reset_database as Reset

    database = _Database()
    monkeypatch.setattr(Reset, "get_database", lambda: database)
    monkeypatch.delenv("MONGODB_URI", raising=False)

    Reset.reset_database()

    assert "markets" in database.deleted and "users" in database.deleted
