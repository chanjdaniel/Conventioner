"""Shared test bootstrap: import paths and stubs for optional runtime dependencies.

pytest imports this before any test module, so the stubs below are installed exactly
once and test modules never have to care about collection order.
"""
import os
import sys
import types
from types import SimpleNamespace

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
