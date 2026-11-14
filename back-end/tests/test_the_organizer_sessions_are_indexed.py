"""The boot builds the indexes an organizer's sign-ins rest on, and refuses to start without them
(ADR 0028): a TTL index that removes a sign-in once it has ended, and an index by account, which
ending every sign-in of an account reads by."""
import logging

import pytest

from conftest import skip_without_real_dependencies

skip_without_real_dependencies()

from pymongo.errors import OperationFailure

import app as app_module
import organizer_sessions as OrganizerSessions


class Indexes:
    """A collection that records the indexes built on it, or refuses to build them."""

    def __init__(self, build_fails=False):
        self.built = []
        self.build_fails = build_fails

    def create_index(self, keys, **options):
        if self.build_fails:
            raise OperationFailure("fixture: the index cannot be built", code=85)
        self.built.append((keys, options))
        return options.get("name")


def test_the_boot_builds_the_expiry_index_and_the_account_index(monkeypatch):
    collection = Indexes()
    monkeypatch.setattr(OrganizerSessions, "sessions_collection", collection)

    app_module.verify_organizer_session_indexes()

    assert collection.built == [
        ([("expires_at", 1)], {"expireAfterSeconds": 0, "name": "organizer_session_ttl"}),
        ([("user_id", 1)], {"name": "organizer_session_user"}),
    ]


def test_the_boot_refuses_to_start_when_they_cannot_be_built(monkeypatch, caplog):
    monkeypatch.setattr(OrganizerSessions, "sessions_collection", Indexes(build_fails=True))

    with caplog.at_level(logging.CRITICAL), \
            pytest.raises(OrganizerSessions.OrganizerSessionIndexError) as refusal:
        app_module.verify_organizer_session_indexes()

    [logged] = [r for r in caplog.records if r.levelno == logging.CRITICAL]
    assert logged.getMessage().startswith(
        "Refusing to start: Could not build the indexes on organizer_sessions "
        "(OperationFailure, code 85)")
    assert refusal.value.__cause__ is None
