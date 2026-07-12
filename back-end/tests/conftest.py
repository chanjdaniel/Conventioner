"""Shared test bootstrap: import paths and stubs for optional runtime dependencies.

pytest imports this before any test module, so the stubs below are installed exactly
once and test modules never have to care about collection order.
"""
import os
import sys
import types
from types import SimpleNamespace

import pytest

BACK_END_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

for path in (BACK_END_DIR, os.path.join(BACK_END_DIR, "migrations")):
    if path not in sys.path:
        sys.path.insert(0, path)

if "pymongo" not in sys.modules:
    fake_pymongo = types.ModuleType("pymongo")
    fake_pymongo_results = types.ModuleType("pymongo.results")

    class _FakeCollection:
        def find_one(self, *_args, **_kwargs):
            return None

        def find(self, *_args, **_kwargs):
            return iter([])

        def update_one(self, *_args, **_kwargs):
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)

        def update_many(self, *_args, **_kwargs):
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)

    class _FakeDatabase(dict):
        def __getitem__(self, _name):
            return _FakeCollection()

    class _FakeMongoClient:
        def __init__(self, *_args, **_kwargs):
            pass

        def __getitem__(self, _name):
            return _FakeDatabase()

    fake_pymongo.MongoClient = _FakeMongoClient
    fake_pymongo.results = fake_pymongo_results
    fake_pymongo_results.InsertOneResult = object
    fake_pymongo_results.UpdateResult = object
    fake_pymongo_results.DeleteResult = object
    sys.modules["pymongo"] = fake_pymongo
    sys.modules["pymongo.results"] = fake_pymongo_results

if "bson" not in sys.modules:
    fake_bson = types.ModuleType("bson")
    fake_bson.ObjectId = str
    sys.modules["bson"] = fake_bson

if "flask" not in sys.modules:
    fake_flask = types.ModuleType("flask")
    fake_flask.request = SimpleNamespace()
    fake_flask.jsonify = lambda payload: payload
    fake_flask.send_file = lambda *args, **kwargs: None
    sys.modules["flask"] = fake_flask

if "flask_login" not in sys.modules:
    fake_flask_login = types.ModuleType("flask_login")

    class _FakeUserMixin:
        pass

    fake_flask_login.UserMixin = _FakeUserMixin
    sys.modules["flask_login"] = fake_flask_login

if "resend" not in sys.modules:
    fake_resend = types.ModuleType("resend")
    fake_resend.Emails = SimpleNamespace(send=lambda *_args, **_kwargs: {})
    sys.modules["resend"] = fake_resend


from datatypes import AssignmentObject, Market, MarketPhase, MarketRole


class FakeMarketsCollection:
    """Stand-in for the markets collection, holding one market document."""

    def __init__(self, doc):
        self.doc = doc
        self.last_update = None
        self.inserted = None

    def find_one(self, _query):
        return dict(self.doc) if self.doc is not None else None

    def update_one(self, _filter, update):
        self.last_update = update
        return SimpleNamespace(matched_count=1, modified_count=1, upserted_id=None)

    def insert_one(self, document):
        self.inserted = document
        return SimpleNamespace(inserted_id="mongo-id")


def stored_market(phase: MarketPhase = MarketPhase.DRAFT, **overrides) -> dict:
    """A market document as Mongo holds it: camelCase, with the server-owned phase stamped on."""
    doc = {
        "id": "market-123",
        "name": "Test Market",
        "creationDate": "2026-01-01T00:00:00Z",
        "roles": {"user-1": "owner"},
        "modificationList": [],
        "assignmentObject": {"vendorAssignments": [], "assignmentStatistics": None},
        "isDraft": phase == MarketPhase.DRAFT,
        "phase": phase.value,
    }
    doc.update(overrides)
    return doc


def client_market(**overrides) -> Market:
    """A market body as the front-end PUTs it back: no phase, no Conventioner fields."""
    kwargs = {
        "id": "market-123",
        "name": "Test Market",
        "creation_date": "2026-01-01T00:00:00Z",
        "roles": {"user-1": MarketRole.OWNER},
        "modification_list": [],
        "assignment_object": AssignmentObject(),
        "is_draft": True,
    }
    kwargs.update(overrides)
    return Market(**kwargs)


class FakeApplicationsCollection:
    """Stand-in for the applications collection the D9 form lock counts.

    ``count_documents`` matches inserted documents against the filter the way Mongo does,
    so a test can pin the persisted key contract by inserting a real ``Application`` dump.
    Tests that only care that *some* applications exist can set ``count`` instead.
    """

    def __init__(self, count: int = 0):
        self.count = count
        self.documents: list = []

    def insert_one(self, document):
        self.documents.append(document)
        return SimpleNamespace(inserted_id=str(len(self.documents)))

    def count_documents(self, query):
        matched = sum(
            1 for doc in self.documents
            if all(doc.get(key) == value for key, value in (query or {}).items())
        )
        return self.count + matched


@pytest.fixture(autouse=True)
def applications(monkeypatch):
    """The D9 lock counts applications; keep that off the real database everywhere."""
    import api.applications as ApplicationsApi

    fake = FakeApplicationsCollection()
    monkeypatch.setattr(ApplicationsApi, "applications_collection", fake)
    return fake
