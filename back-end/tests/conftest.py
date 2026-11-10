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
import re
import sys
import types
from datetime import datetime, timezone
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
# Sessions in the signed cookie, so the suite writes nothing into the source tree. On disk they went
# to `back-end/flask_session`, which a container that ran the back end leaves owned by root, and
# every signed-in test then answered 401 on that checkout.
os.environ.setdefault("SESSION_TYPE", "null")


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


def sessions_load_through_get_user(monkeypatch):
    """Load a test's session through its own ``UsersApi.get_user``, by the address it wrote.

    The app loads a session by its sign-in id, which names the account's login id and when it
    signed in. A test that signs in by writing ``session["_user_id"] = <address>`` and patching
    ``UsersApi.get_user`` uses the address as its fake account's sign-in, so the loader is pointed
    at that patch, whenever it is made.
    """
    import api.users as UsersApi

    monkeypatch.setattr(UsersApi, "signed_in_account", lambda sign_in: UsersApi.get_user(sign_in))


def accounts_by_id(monkeypatch, account_of):
    """Answer every lookup of an account by id from ``account_of(user_id)``, the account or None:
    the one-id read and the batch read alike (T204), so a test's people are the same whichever
    read a path makes."""
    import api.users as UsersApi

    monkeypatch.setattr(UsersApi, "get_user_by_id", account_of)
    monkeypatch.setattr(UsersApi, "get_users_by_ids", lambda user_ids: {
        user_id: account for user_id in dict.fromkeys(user_ids)
        if (account := account_of(user_id))})


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
    The exclusion form (every field 0, as the organization's history reads) drops the top-level
    fields it names and keeps the rest.
    """
    if not projection:
        return doc
    if not any(projection.values()):
        return {key: value for key, value in doc.items() if key not in projection}
    kept: dict = {}
    for path, wanted in projection.items():
        if not wanted:
            continue
        head, _, rest = path.partition(".")
        if head not in doc:
            continue
        if not rest:
            kept[head] = doc[head]
        elif isinstance(doc[head], dict):
            # A dotted path keeps only that part of the sub-document, as Mongo does.
            inner = mongo_project(doc[head], {rest: 1})
            kept[head] = {**kept.get(head, {}), **inner}
    if "_id" in doc and projection.get("_id", 1):
        kept.setdefault("_id", doc["_id"])
    return kept


def reject_malformed_update(update):
    """Refuse an update document Mongo itself would refuse, as ``update_one`` does.

    A fake that records the update without looking at it accepts things the driver rejects, and the
    suite is then green on a call that 500s in production. That is exactly how a double-wrapped
    ``{"$set": market_doc_set(...)}`` reached a running stack: ``market_doc_set`` already returns
    the operator document, so the value under ``$set`` was another ``$set``, and Mongo answers
    "the dollar ($) prefixed field '$set' ... is not allowed".
    """
    if not isinstance(update, dict) or not update:
        raise ValueError(f"update document must be a non-empty dict, got {update!r}")

    operators = [key for key in update if key.startswith("$")]
    if operators and len(operators) != len(update):
        raise ValueError(f"update document mixes operators with plain fields: {sorted(update)}")

    for operator in operators:
        fields = update[operator]
        if not isinstance(fields, dict):
            raise ValueError(f"{operator} takes a field map, got {fields!r}")
        nested = [field for field in fields if field.startswith("$")]
        if nested:
            raise ValueError(
                f"The dollar ($) prefixed field {nested[0]!r} in {operator!r} is not allowed"
            )


class FakeMarketsCollection:
    """Stand-in for the markets collection, holding one market document."""

    def __init__(self, doc):
        self.doc = doc
        self.last_update = None
        self.inserted = None

    def find_one(self, query, projection=None):
        # The filter is applied, as Mongo would: a rename asks whether ANOTHER market holds the
        # address (`id: {$ne: ...}`), and a fake that ignored the filter would answer "yes, this one".
        if self.doc is None or not mongo_matches(self.doc, query):
            return None
        return mongo_project(dict(self.doc), projection)

    def update_one(self, _filter, update):
        reject_malformed_update(update)
        self.last_update = update
        return SimpleNamespace(matched_count=1, modified_count=1, upserted_id=None)

    def insert_one(self, document):
        self.inserted = document
        return SimpleNamespace(inserted_id="mongo-id")

    def delete_one(self, _filter):
        deleted = self.doc is not None
        self.doc = None
        return SimpleNamespace(deleted_count=1 if deleted else 0)


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
        reject_malformed_update(update)
        self.last_update = update
        return SimpleNamespace(matched_count=1, modified_count=1, upserted_id=None)

    def insert_one(self, _document):
        return SimpleNamespace(inserted_id="fake-id")


class UnmodelledQuery(AssertionError):
    """A filter the shared fakes do not model, refused rather than answered.

    A fake that reads an operator it does not know as met hands back every document, so a test of
    a new filter through it is green whatever the filter says. Refusing it fails that test at once,
    naming the operator, and the author either models it here, with its cases in
    ``tests/mongo_cases.py``, or tests the filter against the real server (``tests/real_mongo/``).
    A subclass of ``AssertionError``, so pytest reports a failed test, not an error in the code.
    """


#: A path that reaches no value, as distinct from a value that is null.
_MISSING = object()

_LOGICAL_OPERATORS = ("$and", "$or", "$nor")
_RANGE_OPERATORS = {
    "$gt": lambda value, bound: value > bound,
    "$gte": lambda value, bound: value >= bound,
    "$lt": lambda value, bound: value < bound,
    "$lte": lambda value, bound: value <= bound,
}


def _refuse(what: str):
    raise UnmodelledQuery(f"the shared matcher does not model {what}")


def mongo_matches(doc: dict, query: dict) -> bool:
    """Evaluate a Mongo filter as MongoDB 8.0 does, or refuse it with ``UnmodelledQuery``.

    Every shared fake of this file finds documents through this, since a fake that ignores its
    filter passes a document the server would never have handed back. It models ``$eq``, ``$ne``,
    ``$gt``, ``$gte``, ``$lt``, ``$lte``, ``$in``, ``$nin``, ``$exists``, ``$size``,
    ``$type: "object"``, ``$and``, ``$or`` and ``$nor``; dotted paths through sub-documents and
    through lists, to any element and by a numeric index; a value, ``$in``, ``$ne`` and ``$nin``
    against a list field by its elements; null as matching a missing field; a whole sub-document
    equal only in the same field order; and a range across two BSON types as matching nothing.
    Anything else (``$regex``, ``$elemMatch``, ``$not``, any other ``$type``, an operator it does
    not know) raises ``UnmodelledQuery`` naming it, and so does a malformed filter the server
    refuses. Every operator of the filter is read, so an unmodelled one is refused even where an
    earlier term already decided the answer.

    ``tests/mongo_cases.py`` holds the cases it is checked by: ``tests/test_the_shared_matcher.py``
    runs them through this on every run, and ``tests/real_mongo/`` runs them through a real server.
    A change here comes with its cases there.
    """
    if not isinstance(query, dict):
        _refuse(f"a filter that is not a document: {query!r}")
    answers = [_holds(doc, key, condition) for key, condition in query.items()]
    return all(answers)


def _holds(doc: dict, key: str, condition) -> bool:
    if key in _LOGICAL_OPERATORS:
        if not isinstance(condition, list) or not condition:
            _refuse(f"{key!r} over anything but a non-empty list of filters")
        answers = [mongo_matches(doc, clause) for clause in condition]
        if key == "$and":
            return all(answers)
        if key == "$or":
            return any(answers)
        return not any(answers)
    if key.startswith("$"):
        _refuse(f"the query operator {key!r}")
    leaves = _leaves(doc, key.split("."))
    # A condition is operators when its first key is one, as the server reads it; any other
    # document is a value to equal whole (a claim's holder, E34/F03/S02).
    if isinstance(condition, dict) and condition and next(iter(condition)).startswith("$"):
        answers = [_meets(leaves, operator, operand) for operator, operand in condition.items()]
        return all(answers)
    return _equals_any(leaves, condition)


def _leaves(value, parts: list) -> list:
    """What a dotted path reaches in ``value``: each value it lands on, or ``_MISSING`` where it
    reads as absent.

    Through a list it reaches every sub-document element and, for a numeric part, the element at
    that index; a scalar element or a nested list is not followed by name, and an index past the
    end reaches nothing, all as the server does.
    """
    if not parts:
        return [value]
    head, rest = parts[0], parts[1:]
    if isinstance(value, dict):
        return _leaves(value[head], rest) if head in value else [_MISSING]
    if isinstance(value, list):
        found = []
        if head.isascii() and head.isdigit() and int(head) < len(value):
            element = value[int(head)]
            # An indexed scalar with more path to go reaches nothing, not a missing field.
            if not rest or isinstance(element, (dict, list)):
                found += _leaves(element, rest)
        for element in value:
            if isinstance(element, dict):
                found += _leaves(element, parts)
        return found
    return [_MISSING]


def _candidates(leaves: list):
    """The values a condition is tried against: each leaf, and each element of a leaf that is a
    list (not deeper)."""
    for leaf in leaves:
        if leaf is _MISSING:
            continue
        yield leaf
        if isinstance(leaf, list):
            yield from leaf


def _meets(leaves: list, operator: str, operand) -> bool:
    if operator == "$eq":
        return _equals_any(leaves, operand)
    if operator == "$ne":
        return not _equals_any(leaves, operand)
    if operator in ("$in", "$nin"):
        if not isinstance(operand, list):
            _refuse(f"{operator!r} over anything but a list")
        answers = [_equals_any(leaves, value) for value in operand]
        return any(answers) if operator == "$in" else not any(answers)
    if operator == "$exists":
        return bool(operand) == any(leaf is not _MISSING for leaf in leaves)
    if operator == "$size":
        if not _is_number(operand) or operand != int(operand):
            _refuse(f"'$size' of {operand!r}")
        return any(isinstance(leaf, list) and len(leaf) == operand for leaf in leaves)
    if operator == "$type":
        if operand != "object":
            _refuse(f"'$type' other than \"object\": {operand!r}")
        return any(isinstance(value, dict) for value in _candidates(leaves))
    if operator in _RANGE_OPERATORS:
        if operand is None:
            # Null is its own type: $gte and $lte of it are equality with null, $gt and $lt nothing.
            return operator in ("$gte", "$lte") and _equals_any(leaves, None)
        bound_type = _comparable_type(operand)
        if bound_type is None:
            _refuse(f"{operator!r} of {operand!r}")
        compare = _RANGE_OPERATORS[operator]
        return any(_comparable_type(value) == bound_type
                   and compare(_comparable(value), _comparable(operand))
                   for value in _candidates(leaves))
    if not operator.startswith("$"):
        _refuse(f"the field {operator!r} beside operators in one condition (the server refuses it)")
    _refuse(f"the query operator {operator!r}")


def _equals_any(leaves: list, value) -> bool:
    _refuse_unmodelled_value(value)
    if value is None:
        return any(leaf is _MISSING for leaf in leaves) or any(
            candidate is None for candidate in _candidates(leaves))
    return any(_bson_equal(candidate, value) for candidate in _candidates(leaves))


def _refuse_unmodelled_value(value):
    if isinstance(value, re.Pattern) or type(value).__name__ == "Regex":
        _refuse(f"a regular expression as a value: {value!r}")


def _is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _utc(moment: datetime) -> datetime:
    # The server keeps a date as UTC and hands it back naive, so a naive date is a UTC one.
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _bson_equal(stored, value) -> bool:
    """Equality as the server compares two values: by type first (``True`` is not ``1``), numbers
    across int and float, sub-documents field by field in order, lists element by element."""
    if isinstance(stored, bool) or isinstance(value, bool):
        return isinstance(stored, bool) and isinstance(value, bool) and stored == value
    if _is_number(stored) and _is_number(value):
        return stored == value
    if isinstance(stored, dict) or isinstance(value, dict):
        return (isinstance(stored, dict) and isinstance(value, dict)
                and list(stored) == list(value)
                and all(_bson_equal(stored[key], value[key]) for key in stored))
    if isinstance(stored, list) or isinstance(value, list):
        return (isinstance(stored, list) and isinstance(value, list) and len(stored) == len(value)
                and all(_bson_equal(a, b) for a, b in zip(stored, value)))
    if isinstance(stored, datetime) and isinstance(value, datetime):
        return _utc(stored) == _utc(value)
    if stored is None or value is None:
        return stored is None and value is None
    return stored == value


def _comparable_type(value):
    """The type a range compares within, or ``None`` for a value no modelled range compares."""
    if isinstance(value, bool):
        return bool
    if _is_number(value):
        return float
    if isinstance(value, str):
        return str
    if isinstance(value, datetime):
        return datetime
    if type(value).__name__ == "ObjectId":
        return "ObjectId"
    return None


def _comparable(value):
    return _utc(value) if isinstance(value, datetime) else value


# A plan complete enough to leave draft (E31/F01/S01): a date still to come, a location, and tables
# at its one tier. As it is stored, camelCase; ``complete_setup()`` is the same plan as a model.
COMPLETE_PLAN = {
    "priority": [],
    "marketDates": [{"date": "2099-08-01"}],
    "tiers": [{"id": 0, "name": "Gold"}],
    "locations": [{"name": "Main Hall"}],
    "sections": [
        {"name": "Main Hall", "count": 4, "location": {"name": "Main Hall"},
         "tier": {"id": 0, "name": "Gold"}},
        {"name": "Garden", "count": 4, "location": {"name": "Main Hall"},
         "tier": {"id": 0, "name": "Gold"}},
    ],
    "assignmentOptions": {},
    "floorplans": [],
}


def complete_setup():
    """``COMPLETE_PLAN`` as the model a ``Market`` holds."""
    from assignment.utils import convert_keys_to_snake_case
    from datatypes import SetupObject

    return SetupObject(**convert_keys_to_snake_case(COMPLETE_PLAN))


# The review setup decided (T206): nothing leads the card and no answer rejects, each chosen, so a
# draft meant to leave draft is judged on everything else. As it is stored, camelCase, spread into a
# document (``**REVIEW_SETUP_DECIDED``); ``review_setup_decided()`` is the same as a model's fields.
REVIEW_SETUP_DECIDED = {"nothingLeadsTheCard": True, "noAutomaticRejections": True}


def review_setup_decided() -> dict:
    """``REVIEW_SETUP_DECIDED`` as ``Market``'s keyword arguments."""
    from assignment.utils import convert_keys_to_snake_case

    return convert_keys_to_snake_case(REVIEW_SETUP_DECIDED)


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


class _SortableCursor:
    """A list that exposes .sort() returning self, so a fake ``find`` can chain sort/limit."""

    def __init__(self, results):
        self._results = results

    def sort(self, _key, _direction=None):
        return self

    def limit(self, _n):
        return self

    def __iter__(self):
        return iter(self._results)

    def __bool__(self):
        return bool(self._results)


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
        return mongo_matches(doc, query)

    def _find(self, query):
        for doc in self.documents:
            if self._matches(doc, query):
                return doc
        return None

    def find_one(self, query):
        doc = self._find(query)
        return dict(doc) if doc else None

    def find(self, query, projection=None):
        results = []
        for doc in self.documents:
            if self._matches(doc, query):
                results.append(mongo_project(dict(doc), projection))
        return _SortableCursor(results)

    def insert_one(self, document):
        self.documents.append(document)
        return SimpleNamespace(inserted_id=str(len(self.documents)))

    def _apply(self, doc, update):
        # A dotted path reaches into the sub-document, as Mongo's does.
        for key, value in (update.get("$set") or {}).items():
            *parents, last = key.split(".")
            target = doc
            for part in parents:
                target = target.setdefault(part, {})
            target[last] = value
        for key in (update.get("$unset") or {}):
            *parents, last = key.split(".")
            target = doc
            for part in parents:
                target = target.get(part) if isinstance(target, dict) else None
            if isinstance(target, dict):
                target.pop(last, None)
        for key, value in (update.get("$push") or {}).items():
            doc.setdefault(key, []).append(value)
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

    def delete_one(self, query):
        doc = self._find(query)
        if doc is not None:
            self.documents.remove(doc)
        return SimpleNamespace(deleted_count=0 if doc is None else 1)

    def delete_many(self, query):
        doomed = [doc for doc in self.documents if self._matches(doc, query)]
        for doc in doomed:
            self.documents.remove(doc)
        return SimpleNamespace(deleted_count=len(doomed))

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


@pytest.fixture(autouse=True)
def market_records(monkeypatch):
    """The other records a market keeps beside itself, which deleting it deletes (bug 47).

    Off the real database for the same reason as applications: the suite points Mongo at a port
    nothing listens on, and a delete against it would wait out the server-selection timeout.
    """
    if STUBBED_MODULES:
        return None
    import api.applicant_auth as ApplicantAuth
    import api.attendance as AttendanceApi
    import history as History
    import payments as Payments
    import remembered_sign_ins as RememberedSignIns
    import services.gridfs_service as GridfsService
    import vendor_notes as VendorNotes

    fakes = SimpleNamespace(
        attendance=FakeApplicationsCollection(), challenges=FakeApplicationsCollection(),
        remembered=FakeApplicationsCollection(),
        history=FakeApplicationsCollection(), notes=FakeApplicationsCollection(),
        placement_history=FakeApplicationsCollection(), payments=FakeApplicationsCollection(),
        amounts_owed=FakeApplicationsCollection(), images=FakeGridFS(),
    )
    monkeypatch.setattr(GridfsService, "_fs", fakes.images)
    monkeypatch.setattr(Payments, "payments_collection", fakes.payments)
    monkeypatch.setattr(Payments, "amounts_owed_collection", fakes.amounts_owed)
    monkeypatch.setattr(VendorNotes, "vendor_notes_collection", fakes.notes)
    monkeypatch.setattr(AttendanceApi, "attendance_collection", fakes.attendance)
    monkeypatch.setattr(ApplicantAuth, "challenges_collection", fakes.challenges)
    monkeypatch.setattr(RememberedSignIns, "remembered_collection", fakes.remembered)
    monkeypatch.setattr(History, "history_collection", fakes.history)
    monkeypatch.setattr(History, "legacy_placement_collection", fakes.placement_history)
    return fakes

class FakeAttemptsCollection:
    """The ``sign_in_attempts`` collection: an ``$inc`` upsert by ``_id``, a conditional ``$inc``,
    and its index."""

    def __init__(self):
        self.docs = {}
        self.indexes = []

    def create_index(self, keys, **kwargs):
        self.indexes.append((keys, kwargs))
        return kwargs.get("name", "fake-index")

    def find_one(self, query):
        doc = self.docs.get(query["_id"])
        return dict(doc) if doc else None

    def find_one_and_update(self, query, update, upsert=False, return_document=None):
        key = query["_id"]
        doc = self.docs.get(key)
        if doc is None:
            if not upsert:
                return None
            doc = {"_id": key, **update.get("$setOnInsert", {})}
            self.docs[key] = doc
        for field, amount in update.get("$inc", {}).items():
            doc[field] = doc.get(field, 0) + amount
        return dict(doc)

    def update_one(self, query, update):
        doc = self.docs.get(query["_id"])
        if doc is None or not mongo_matches(doc, query):
            return SimpleNamespace(matched_count=0, modified_count=0)
        for field, amount in update.get("$inc", {}).items():
            doc[field] = doc.get(field, 0) + amount
        return SimpleNamespace(matched_count=1, modified_count=1)


@pytest.fixture(autouse=True)
def sign_in_attempts(monkeypatch):
    """Every sign-in's rate limit counters, fresh for every test (T12)."""
    if STUBBED_MODULES:
        return None
    import sign_in_limits

    fake = FakeAttemptsCollection()
    monkeypatch.setattr(sign_in_limits, "attempts_collection", fake)
    return fake


class FakeGridFS:
    """The floorplan image store, holding each file's bytes, name and metadata as GridFS does."""

    def __init__(self):
        self.files = {}

    def put(self, data, filename=None, metadata=None):
        from bson import ObjectId

        file_id = ObjectId()
        self.files[file_id] = {"data": data, "filename": filename, "metadata": metadata}
        return file_id

    def find_one(self, file_filter):
        stored = self.files.get(file_filter.get("_id"))
        if stored is None:
            return None
        return SimpleNamespace(_id=file_filter["_id"], **stored)

    def find(self, file_filter):
        """Every stored file the filter matches, as GridFS's cursor yields them."""
        return iter([
            SimpleNamespace(_id=file_id, **stored) for file_id, stored in list(self.files.items())
            if mongo_matches({"_id": file_id, **stored}, file_filter)
        ])

    def get(self, file_id):
        from gridfs.errors import NoFile

        stored = self.files.get(file_id)
        if stored is None:
            raise NoFile(file_id)
        return SimpleNamespace(read=lambda: stored["data"])

    def delete(self, file_id):
        from gridfs.errors import NoFile

        if file_id not in self.files:
            raise NoFile(file_id)
        del self.files[file_id]

    def metadata_of(self, gridfs_id):
        from bson import ObjectId

        return self.files[ObjectId(gridfs_id)]["metadata"]


class FakeTemplates:
    """The floorplan templates collection, matching a filter's fields by equality."""

    def __init__(self, *docs):
        self.docs = [dict(doc) for doc in docs]

    def _matches(self, doc, query):
        return all(doc.get(key) == value for key, value in query.items())

    def find_one(self, query):
        return next((dict(doc) for doc in self.docs if self._matches(doc, query)), None)

    def find(self, query):
        return [dict(doc) for doc in self.docs if self._matches(doc, query)]

    def insert_one(self, doc):
        self.docs.append(dict(doc))
        return SimpleNamespace(inserted_id="inserted")

    def update_one(self, query, update):
        for doc in self.docs:
            if self._matches(doc, query):
                doc.update(update["$set"])
                return SimpleNamespace(modified_count=1)
        return SimpleNamespace(modified_count=0)

    def delete_one(self, query):
        before = len(self.docs)
        self.docs = [doc for doc in self.docs if not self._matches(doc, query)]
        return SimpleNamespace(deleted_count=before - len(self.docs))


class FakeOrganizations:
    """The organizations collection, read only, recording every filter it is asked with."""

    def __init__(self, *docs):
        self.docs = [dict(doc) for doc in docs]
        self.queries = []

    def find_one(self, query, projection=None):
        return next(self.find(query, projection), None)

    def find(self, query, projection=None):
        self.queries.append(query)
        return iter([
            mongo_project(dict(doc), projection) for doc in self.docs if mongo_matches(doc, query)
        ])

# app.py refuses to boot unless the market-key migration is recorded as applied, and it fails
# closed when it cannot read the marker at all -- which is exactly what would happen here, since
# the suite points Mongo at a port nothing listens on. The probe is answered in-process instead,
# by a database that reports the migration as applied. Only the probe is redirected: the data
# collections stay unreachable, so a test that touches an unpatched one still fails loudly.
import db_config
from market_documents import MARKET_MIGRATION_IDS, MONGO_ID_KEY, SCHEMA_COLLECTION


class _MigratedProbeDatabase:
    client = SimpleNamespace(close=lambda: None)

    # Every marker the boot check asks for, so a marker added to the canonical form is one this
    # probe answers without a second list to keep in step.
    _markers = {marker: {MONGO_ID_KEY: marker} for marker in MARKET_MIGRATION_IDS}

    def __getitem__(self, name):
        assert name == SCHEMA_COLLECTION, "the probe reads the schema marker and nothing else"
        return SimpleNamespace(
            find_one=lambda query: _MigratedProbeDatabase._markers.get(
                query.get(MONGO_ID_KEY)
            )
        )


db_config.get_migration_probe_database = lambda *_args, **_kwargs: _MigratedProbeDatabase()


# app.py builds the lookup indexes at boot (``lookup_indexes``). Here they are built into a
# stand-in that only holds indexes; what gets built is ``test_lookup_indexes.py``'s to check.
class _IndexOnlyCollection:
    def __init__(self):
        self._indexes = {"_id_": {"key": [("_id", 1)]}}

    def index_information(self):
        return dict(self._indexes)

    def create_index(self, keys, **_options):
        name = "_".join(f"{field}_{direction}" for field, direction in keys)
        self._indexes[name] = {"key": list(keys)}
        return name


class _IndexOnlyDatabase(dict):
    def __missing__(self, name):
        self[name] = _IndexOnlyCollection()
        return self[name]


# What this file puts in place of a back-end module's attribute at import, for every test, with the
# attribute's own value: the real-MongoDB suite (``tests/real_mongo/``) puts each back before it binds
# the handles to its database.
IMPORT_TIME_STAND_INS: dict = {}


def _stand_in(module, attribute: str, stand_in) -> None:
    """Put ``stand_in`` where ``module.attribute`` is, keeping the value it replaces."""
    IMPORT_TIME_STAND_INS.setdefault((module.__name__, attribute), getattr(module, attribute))
    setattr(module, attribute, stand_in)


import lookup_indexes

_stand_in(lookup_indexes, "_boot_database", _IndexOnlyDatabase)

# app.py also refuses to boot unless it can build the unique index the application endpoint
# rests on, and it builds it for real, against the collection the module holds. Here that
# collection is the fake below -- installed at import, not only per test, because a test
# module that imports app.py imports it at collection time, before any fixture has run. The
# autouse fixture above still hands each test its own empty collection; this is only what the
# boot check builds its index against.
if not STUBBED_MODULES:
    import api.applications as _applications_module

    _stand_in(_applications_module, "applications_collection", FakeApplicationsCollection())

    # The applicant login challenge module also has a collection that the boot
    # check builds indexes against. Same treatment as applications above: install
    # a fake so the boot check passes without reaching a real database.
    import api.applicant_auth as _applicant_auth_module

    _stand_in(_applicant_auth_module, "challenges_collection", FakeApplicationsCollection())

    # The sign-in rate limit counters, whose expiry index the same boot check builds (T12).
    import sign_in_limits as _sign_in_limits_module

    _stand_in(_sign_in_limits_module, "attempts_collection", FakeAttemptsCollection())

    # And the vendors' remembered sign-ins, whose expiry index the same boot check builds (T202).
    import remembered_sign_ins as _remembered_sign_ins_module

    _stand_in(_remembered_sign_ins_module, "remembered_collection", FakeApplicationsCollection())

    # And the users collection, whose unique address index the boot builds (E32/F03/S04).
    import api.users as _users_module

    _users_fake = FakeApplicationsCollection()
    _users_fake.index_information = lambda: {}
    _stand_in(_users_module, "users_collection", _users_fake)


def a_solver_vendor(application_id: str = "app-1", **overrides):
    """One vendor as the solver reads them, for a test that stubs the solver's input.

    A real ``SolverVendor`` rather than a placeholder: a run fingerprints what it read
    (E22/F03/S01), and a string has no fields to read.
    """
    from assignment.vendor_input import SolverVendor

    fields = dict(
        application_id=application_id,
        email=f"{application_id}@example.com",
        available_dates=frozenset({"2026-08-01"}),
        max_dates=1,
        accepted_tiers_by_date={"2026-08-01": frozenset({"Gold"})},
        table_choice="Full Table",
        table_share_email=None,
        section_ranking=(),
        table_type_ranking=(),
    )
    fields.update(overrides)
    return SolverVendor(**fields)
