"""Shared test bootstrap: import paths and stubs for optional runtime dependencies.

pytest imports this before any test module, so the stubs below are installed exactly
once and test modules never have to care about collection order.

A stub is installed only when the real dependency is not importable. When the full
requirements.txt is installed (as in CI), the real modules win, so route-level tests
can import app.py and exercise Flask endpoints through the test client. In that case
the real pymongo driver is in play, so an unconfigured environment is pointed at a
port nothing can listen on, with a short server selection timeout: a test that reaches
an unpatched collection fails loudly in a fraction of a second instead of silently
reading or writing a developer's live local database.
"""
import importlib.util
import os
import sys
import types
from types import SimpleNamespace

import pytest

BACK_END_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

STUBBED_MODULES = set()

for path in (BACK_END_DIR, os.path.join(BACK_END_DIR, "migrations")):
    if path not in sys.path:
        sys.path.insert(0, path)

MONGO_ENV_KEYS = (
    "MONGODB_URI",
    "MONGODB_HOST",
    "MONGODB_PORT",
    "MONGODB_USER",
    "MONGODB_PASSWORD",
    "MONGODB_AUTH_DB",
)

UNREACHABLE_MONGODB_URI = "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=100"

if not any(os.getenv(key) for key in MONGO_ENV_KEYS):
    os.environ["MONGODB_URI"] = UNREACHABLE_MONGODB_URI

# The test suite is the one place the boot check is allowed to be off: every test that asserts a
# defense works unsets it, and every other test simply does not care about what it skips.
os.environ.setdefault("ALLOW_INSECURE_LOCAL_DEV", "true")


def _needs_stub(module_name: str) -> bool:
    """True when module_name is neither already imported nor installed."""
    if module_name in sys.modules:
        return False
    try:
        missing = importlib.util.find_spec(module_name) is None
    except (ImportError, ValueError):
        missing = True
    if missing:
        STUBBED_MODULES.add(module_name)
    return missing


def skip_without_real_dependencies():
    """Skip the calling module when the suite is running on the stubs below.

    Route-level tests import app.py, which needs the real runtime stack (the Flask
    class, flask_session, flask_bcrypt, flask_cors and the floorplan blueprints'
    imaging dependencies). The stubs fake data-layer modules, not a web framework,
    so those tests have to skip rather than fail at collection when requirements.txt
    is not installed. Any stub at all means this is the dependency-free environment.
    """
    if STUBBED_MODULES:
        pytest.skip(
            "requires the real backend dependencies; running on stubs for "
            + ", ".join(sorted(STUBBED_MODULES)),
            allow_module_level=True,
        )


if _needs_stub("pymongo"):
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

    fake_pymongo_errors = types.ModuleType("pymongo.errors")

    class _FakePyMongoError(Exception):
        pass

    class _FakeDuplicateKeyError(_FakePyMongoError):
        pass

    fake_pymongo.MongoClient = _FakeMongoClient
    fake_pymongo.results = fake_pymongo_results
    fake_pymongo.errors = fake_pymongo_errors
    fake_pymongo.ReturnDocument = SimpleNamespace(BEFORE=False, AFTER=True)
    fake_pymongo_errors.PyMongoError = _FakePyMongoError
    fake_pymongo_errors.DuplicateKeyError = _FakeDuplicateKeyError
    fake_pymongo_results.InsertOneResult = object
    fake_pymongo_results.UpdateResult = object
    fake_pymongo_results.DeleteResult = object
    sys.modules["pymongo"] = fake_pymongo
    sys.modules["pymongo.results"] = fake_pymongo_results
    sys.modules["pymongo.errors"] = fake_pymongo_errors

if _needs_stub("bson"):
    fake_bson = types.ModuleType("bson")
    fake_bson.ObjectId = str
    sys.modules["bson"] = fake_bson

if _needs_stub("flask"):
    fake_flask = types.ModuleType("flask")
    fake_flask.request = SimpleNamespace()
    fake_flask.jsonify = lambda payload: payload
    fake_flask.send_file = lambda *args, **kwargs: None
    sys.modules["flask"] = fake_flask

if _needs_stub("flask_login"):
    fake_flask_login = types.ModuleType("flask_login")

    class _FakeUserMixin:
        pass

    fake_flask_login.UserMixin = _FakeUserMixin
    sys.modules["flask_login"] = fake_flask_login

if _needs_stub("resend"):
    fake_resend = types.ModuleType("resend")
    fake_resend.Emails = SimpleNamespace(send=lambda *_args, **_kwargs: {})
    sys.modules["resend"] = fake_resend

if _needs_stub("dotenv"):
    fake_dotenv = types.ModuleType("dotenv")
    fake_dotenv.load_dotenv = lambda *_args, **_kwargs: False
    fake_dotenv.dotenv_values = lambda *_args, **_kwargs: {}
    sys.modules["dotenv"] = fake_dotenv

# app.py loads `back-end/.env` on its first line, and two test modules import app - so without this
# the suite would read whatever untracked file the machine running it happens to hold, and its result
# would depend on it. It is not hypothetical: the `.env` a developer already has was written from the
# *old* template, which printed a published placeholder for all three secrets, and every one of them
# is now refused by name (escape hatch or not) - so those modules would fail at collection here while
# passing in CI, where the checkout has no `.env` at all. The suite reads no `.env`: it is pointed at
# a path that does not exist, the same way the migration probe below is answered in-process.
import utils.env_file

utils.env_file.ENV_FILE = utils.env_file.BACK_END_DIR / ".env.the-test-suite-reads-no-env-file"


from datatypes import AssignmentObject, Market, MarketPhase, MarketRole, market_name_slug


def mongo_project(doc: dict, projection) -> dict:
    """Apply a Mongo projection the way the server does, so a fake hands back what Mongo would.

    A fake that ignores the projection hands the caller fields the real query never fetched, which
    is exactly how a read of a field nobody asked for passes here and reads ``None`` in production.
    Only the inclusion form is modelled, because that is the only form these callers use.
    """
    if not projection:
        return doc
    return {key: value for key, value in doc.items() if key in projection}


class FakeMarketsCollection:
    """Stand-in for the markets collection, holding one market document."""

    def __init__(self, doc):
        self.doc = doc
        self.last_update = None
        self.inserted = None

    def find_one(self, _query, projection=None):
        return mongo_project(dict(self.doc), projection) if self.doc is not None else None

    def update_one(self, _filter, update):
        self.last_update = update
        return SimpleNamespace(matched_count=1, modified_count=1, upserted_id=None)

    def insert_one(self, document):
        self.inserted = document
        return SimpleNamespace(inserted_id="mongo-id")


class FakeSlugMarketsCollection:
    """Stand-in for the markets collection, matching filters and projections the way Mongo does.

    ``find`` applies the filter rather than handing back everything, so the public slug lookup is
    exercised as it actually runs: it queries the *stored* slug, and a document that does not carry
    one is a market Mongo would never return. It applies the projection for the same reason, one
    step on: the applicant endpoints fetch the fields they read and no others, and a fake that
    served the whole document would let a read of the rest pass here and find nothing in production.

    It lives here, and not in the two suites that need it, because it did live in both of them: the
    same fake written twice is the same fix applied once.
    """

    def __init__(self, docs):
        self.docs = docs if isinstance(docs, list) else [docs]
        self.last_update = None
        self.last_projection = None

    def find_one(self, query, projection=None):
        return next(self.find(query, projection), None)

    def find(self, query, projection=None):
        self.last_projection = projection
        matched = [dict(d) for d in self.docs if mongo_matches(d, query)]
        return iter([mongo_project(d, projection) for d in matched])

    def update_one(self, _filter, update):
        self.last_update = update
        return SimpleNamespace(matched_count=1, modified_count=1, upserted_id=None)

    def insert_one(self, _document):
        return SimpleNamespace(inserted_id="fake-id")


def mongo_matches(doc: dict, query: dict) -> bool:
    """Evaluate a Mongo filter the way the server does.

    The fakes that stand in for the markets collection share this, because a fake that ignores the
    filter is a fake that passes a document Mongo would never have handed back - which is exactly
    how a lookup querying a field no document carries would go unnoticed here and 404 in
    production. ``$ne``, ``$exists``, ``$in`` and ``$nor`` are modelled because the public slug
    lookup is built out of them.
    """
    for key, condition in (query or {}).items():
        if key == "$nor":
            if any(mongo_matches(doc, clause) for clause in condition):
                return False
            continue
        present = key in doc
        if isinstance(condition, dict):
            if "$exists" in condition and present != condition["$exists"]:
                return False
            if "$ne" in condition and doc.get(key) == condition["$ne"]:
                return False
            if "$in" in condition and doc.get(key) not in condition["$in"]:
                return False
        elif not present or doc[key] != condition:
            return False
    return True


def stored_market(phase: MarketPhase = MarketPhase.DRAFT, **overrides) -> dict:
    """A market document as Mongo holds it: camelCase, phase and slug stamped on by the server.

    The slug is derived from the name here for the same reason ``Market.slug`` derives it on every
    write: it is what the public lookup queries, so a test document without one is a market no
    public URL can reach, and a fixture that hard-coded one could pin a market to a URL its name
    does not spell.
    """
    name = overrides.pop("name", "Test Market")
    doc = {
        "id": "market-123",
        "name": name,
        "creationDate": "2026-01-01T00:00:00Z",
        "roles": {"user-1": "owner"},
        "modificationList": [],
        "assignmentObject": {"vendorAssignments": [], "assignmentStatistics": None},
        "isDraft": phase == MarketPhase.DRAFT,
        "phase": phase.value,
        "slug": market_name_slug(name),
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

    ``find_one_and_update`` is the upsert an application is created by, and it is modelled the way
    Mongo builds one: the document an unmatched filter creates is the filter's equality terms plus
    ``$setOnInsert``. The unique index that makes that upsert safe under concurrency is the
    database's, so it has no analogue here -- what a test can do is raise ``DuplicateKeyError`` the
    way the index does (see ``TestCreatingAnApplicationConcurrently``).
    """

    def __init__(self, count: int = 0):
        self.count = count
        self.documents: list = []

    def create_index(self, *_args, **_kwargs):
        return "fake-index"

    def _matches(self, doc, query):
        return all(doc.get(key) == value for key, value in (query or {}).items())

    def _find(self, query):
        for doc in self.documents:
            if self._matches(doc, query):
                return doc
        return None

    def find_one(self, query):
        doc = self._find(query)
        return dict(doc) if doc else None

    def insert_one(self, document):
        self.documents.append(document)
        return SimpleNamespace(inserted_id=str(len(self.documents)))

    def _apply(self, doc, update):
        for key, value in (update.get("$set") or {}).items():
            doc[key] = value
        return doc

    def update_one(self, query, update):
        doc = self._find(query)
        if doc is None:
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)
        self._apply(doc, update)
        return SimpleNamespace(matched_count=1, modified_count=1, upserted_id=None)

    def find_one_and_update(self, query, update, upsert=False, return_document=None):
        from pymongo import ReturnDocument as RD

        doc = self._find(query)
        if doc is None:
            if not upsert:
                return None
            doc = dict(query or {})
            doc.update(update.get("$setOnInsert") or {})
            self.documents.append(doc)
        before = dict(doc)
        self._apply(doc, update)
        if return_document is RD.AFTER:
            return dict(doc)
        return before

    def count_documents(self, query):
        matched = sum(1 for doc in self.documents if self._matches(doc, query))
        return self.count + matched


@pytest.fixture(autouse=True)
def applications(monkeypatch):
    """The D9 lock counts applications; keep that off the real database everywhere."""
    import api.applications as ApplicationsApi

    fake = FakeApplicationsCollection()
    monkeypatch.setattr(ApplicationsApi, "applications_collection", fake)
    return fake

# app.py refuses to boot unless the market-key migration is recorded as applied, and it fails
# closed when it cannot read the marker at all -- which is exactly what would happen here, since
# the suite points Mongo at a port nothing listens on. The probe is answered in-process instead,
# by a database that reports the migration as applied. Only the probe is redirected: the data
# collections stay unreachable, so a test that touches an unpatched one still fails loudly.
import db_config
from market_documents import MARKET_KEY_MIGRATION_ID, MARKET_SLUG_MIGRATION_ID, MONGO_ID_KEY, SCHEMA_COLLECTION


class _MigratedProbeDatabase:
    client = SimpleNamespace(close=lambda: None)

    _markers = {
        MARKET_KEY_MIGRATION_ID: {MONGO_ID_KEY: MARKET_KEY_MIGRATION_ID},
        MARKET_SLUG_MIGRATION_ID: {MONGO_ID_KEY: MARKET_SLUG_MIGRATION_ID},
    }

    def __getitem__(self, name):
        assert name == SCHEMA_COLLECTION, "the probe reads the schema marker and nothing else"
        return SimpleNamespace(
            find_one=lambda query: _MigratedProbeDatabase._markers.get(
                query.get(MONGO_ID_KEY)
            )
        )


db_config.get_migration_probe_database = lambda *_args, **_kwargs: _MigratedProbeDatabase()

# app.py also refuses to boot unless it can build the unique index the application endpoint
# rests on, and it builds it for real, against the collection the module holds. Here that
# collection is the fake below -- installed at import, not only per test, because a test
# module that imports app.py imports it at collection time, before any fixture has run. The
# autouse fixture above still hands each test its own empty collection; this is only what the
# boot check builds its index against.
if not STUBBED_MODULES:
    import api.applications as _applications_module

    _applications_module.applications_collection = FakeApplicationsCollection()

    # The applicant login challenge module also has a collection that the boot
    # check builds indexes against. Same treatment as applications above: install
    # a fake so the boot check passes without reaching a real database.
    import api.applicant_auth as _applicant_auth_module

    _applicant_auth_module.challenges_collection = FakeApplicationsCollection()
