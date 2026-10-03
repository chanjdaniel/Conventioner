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
