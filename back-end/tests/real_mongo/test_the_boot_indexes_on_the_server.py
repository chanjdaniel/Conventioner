"""Every index the boot builds, on a real server: built twice over one database without error, as a
deploy over an existing database builds them again; and each unique one refusing to build over the
duplicates it forbids, with the error the boot turns into "Refusing to start"."""
import logging
from typing import NamedTuple, Tuple

import pytest

from real_mongo import harness

DUPLICATE_ADDRESS = "planted-duplicate@example.com"


def _every_index(db) -> dict:
    """Every index on the database, by collection, as the server describes it."""
    return {name: db[name].index_information() for name in sorted(db.list_collection_names())}


def _unique_indexes(db) -> set:
    return {(collection, index)
            for collection, indexes in _every_index(db).items()
            for index, info in indexes.items() if info.get("unique")}


class Duplicates(NamedTuple):
    """Two documents a unique boot index forbids together, and the boot check that refuses them."""

    collection: str
    index: str
    documents: Tuple[dict, ...]
    boot_check: str  # the ``app`` function that refuses to start
    error: str  # ``module.Class`` the build raises and the boot check lets stop the boot


DUPLICATES = (
    Duplicates(
        "applications", "market_applicant_type_unique",
        ({"id": "app-1", "market_id": "market-1", "applicant_email": DUPLICATE_ADDRESS,
          "application_type": "main"},
         {"id": "app-2", "market_id": "market-1", "applicant_email": DUPLICATE_ADDRESS,
          "application_type": "main"}),
        "verify_application_indexes", "api.applications.ApplicationIndexError"),
    Duplicates(
        "applicant_login_challenges", "market_email_unique",
        ({"market_id": "market-1", "email": DUPLICATE_ADDRESS},
         {"market_id": "market-1", "email": DUPLICATE_ADDRESS}),
        "verify_applicant_login_indexes", "api.applicant_auth.ApplicantLoginIndexError"),
    Duplicates(
        "users", "user_email",
        ({"id": "user-1", "email": DUPLICATE_ADDRESS}, {"id": "user-2", "email": DUPLICATE_ADDRESS}),
        "verify_user_indexes", "api.users.UserIndexError"),
    Duplicates(
        "attendance", "attendance_vendor_day_unique",
        ({"market_id": "market-1", "vendor_email": DUPLICATE_ADDRESS, "date": "2099-05-08"},
         {"market_id": "market-1", "vendor_email": DUPLICATE_ADDRESS, "date": "2099-05-08"}),
        "verify_attendance_indexes", "unique_indexes.UniqueIndexError"),
    Duplicates(
        "amounts_owed", "amounts_owed_vendor_day_unique",
        ({"market_id": "market-1", "vendor_email": DUPLICATE_ADDRESS, "date": "2099-05-08"},
         {"market_id": "market-1", "vendor_email": DUPLICATE_ADDRESS, "date": "2099-05-08"}),
        "verify_payment_indexes", "unique_indexes.UniqueIndexError"),
    Duplicates(
        "payments", "payments_request_key_unique",
        ({"id": "pay-1", "market_id": "market-1", "vendor_email": DUPLICATE_ADDRESS,
          "request_key": "request-key-1"},
         {"id": "pay-2", "market_id": "market-1", "vendor_email": DUPLICATE_ADDRESS,
          "request_key": "request-key-1"}),
        "verify_payment_indexes", "unique_indexes.UniqueIndexError"),
)


def _class(dotted: str):
    import importlib

    module, name = dotted.rsplit(".", 1)
    return getattr(importlib.import_module(module), name)


def _unbuilt(monkeypatch):
    """A process that has not built its indexes yet, as every process is at its boot."""
    import importlib

    for module_name, flag in harness._BUILT_ONCE_FLAGS:
        monkeypatch.setattr(importlib.import_module(module_name), flag, False)


class TestEveryBootIndexBuildsTwice:
    def test_building_them_again_over_the_same_database_raises_nothing_and_changes_nothing(
            self, real_db, monkeypatch):
        harness.build_boot_indexes(monkeypatch)
        first = _every_index(real_db)

        harness.build_boot_indexes(monkeypatch)

        assert _every_index(real_db) == first

    def test_the_second_build_makes_no_lookup_index(self, real_db, monkeypatch):
        from lookup_indexes import ensure_lookup_indexes

        harness.build_boot_indexes(monkeypatch)

        assert ensure_lookup_indexes() == []


class TestEachUniqueBootIndexRefusesOverDuplicates:
    def test_every_unique_index_the_boot_builds_has_its_case_here(self, real_db, monkeypatch):
        """A unique index added to the boot without a case of duplicates fails here."""
        harness.build_boot_indexes(monkeypatch)

        assert _unique_indexes(real_db) == {(case.collection, case.index) for case in DUPLICATES}

    @pytest.mark.parametrize("case", DUPLICATES, ids=lambda case: case.index)
    def test_planted_duplicates_make_the_boot_refuse_to_start(
            self, case, real_db, monkeypatch, caplog):
        import app as app_module

        real_db[case.collection].insert_many([dict(document) for document in case.documents])
        _unbuilt(monkeypatch)

        with caplog.at_level(logging.CRITICAL), pytest.raises(_class(case.error)) as refusal:
            getattr(app_module, case.boot_check)()

        assert any(record.getMessage().startswith("Refusing to start: ")
                   for record in caplog.records)
        assert case.index not in real_db[case.collection].index_information()
        # The server's duplicate key error quotes the address; the refusal never does.
        assert DUPLICATE_ADDRESS not in str(refusal.value)
        assert refusal.value.__cause__ is None
        assert all(DUPLICATE_ADDRESS not in record.getMessage() for record in caplog.records)
