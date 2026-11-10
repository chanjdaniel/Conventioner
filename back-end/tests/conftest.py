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
import copy
import functools
import importlib.util
import os
import re
import sys
import types
import uuid
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
    """Apply a find projection as MongoDB 8.0 does, or refuse it with ``UnmodelledQuery``, so a
    fake hands back what the server would.

    A fake that ignores the projection hands the caller fields the real query never fetched, which
    is exactly how a read of a field nobody asked for passes here and reads ``None`` in production.
    It models inclusion and exclusion by ``1``, ``0``, ``True`` and ``False``, of top-level and
    dotted paths: an inclusion keeps the ``_id`` unless told not to, keeps the document's own field
    order, keeps an empty sub-document where a dotted path finds nothing in it, drops a scalar a
    dotted path runs into, and through a list narrows each sub-document element and drops the
    scalar ones; an exclusion drops each path it names, through a list from every sub-document
    element. Anything else (``$slice``, ``$elemMatch``, a positional path, a literal or any other
    value, inclusion beside exclusion, a path beside its parent) is refused, naming it.

    ``tests/mongo_cases.py``'s ``PROJECTION_CASES`` hold the cases it is checked by, hermetically
    and against the server; a change here comes with its cases there.
    """
    if not projection:
        return doc
    if not isinstance(projection, dict):
        _refuse(f"a projection that is not a document: {projection!r}")
    wanted: dict = {}
    for path, value in projection.items():
        if isinstance(value, bool) or (_is_number(value) and value in (0, 1)):
            wanted[path] = bool(value)
        else:
            _refuse(f"a projection of {path!r} by the value {value!r}")
        if any(not part or part.startswith("$") for part in path.split(".")):
            _refuse(f"the projection path {path!r}")
    fields = {path: keep for path, keep in wanted.items() if path != "_id"}
    including = any(fields.values()) if fields else wanted.get("_id", True)
    for path, keep in fields.items():
        if keep != including:
            _refuse(f"{path!r}: an inclusion beside an exclusion (the server refuses it)")
    if including and wanted.get("_id", True):
        fields = {"_id": True, **fields}
    elif not including and not wanted.get("_id", True):
        fields = {"_id": False, **fields}
    tree = _path_tree(fields)
    return _include(doc, tree) if including else _exclude(doc, tree)


def _path_tree(paths) -> dict:
    """The paths as a tree of their parts, each leaf ``True``; a path beside its parent is
    refused, as the server refuses it."""
    tree: dict = {}
    for path in sorted(paths, key=lambda path: path.count(".")):
        *parents, last = path.split(".")
        node = tree
        for part in parents:
            node = node.setdefault(part, {})
            if node is True:
                _refuse(f"{path!r} beside its parent (the server refuses the collision)")
        if last in node:
            _refuse(f"{path!r} beside its parent (the server refuses the collision)")
        node[last] = True
    return tree


#: What an inclusion keeps of a scalar a dotted path runs into: nothing.
_DROPPED = object()


def _include(value, tree):
    if isinstance(value, dict):
        kept = {}
        for key, item in value.items():
            if key in tree:
                part = copy.deepcopy(item) if tree[key] is True else _include(item, tree[key])
                if part is not _DROPPED:
                    kept[key] = part
        return kept
    if isinstance(value, list):
        return [_include(item, tree) for item in value if isinstance(item, (dict, list))]
    return _DROPPED


def _exclude(value, tree):
    if isinstance(value, dict):
        return {key: (copy.deepcopy(item) if key not in tree else _exclude(item, tree[key]))
                for key, item in value.items() if tree.get(key) is not True}
    if isinstance(value, list):
        return [_exclude(item, tree) for item in value]
    return copy.deepcopy(value)


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


def _identical(stored, value) -> bool:
    """Whether the server would store ``value`` as the very same BSON as ``stored``: one type
    (``1`` is not ``1.0``), one field order, one length. An update that leaves every value
    identical modified nothing."""
    if _bson_kind(stored) is not _bson_kind(value):
        return False
    if isinstance(value, dict):
        return list(stored) == list(value) and all(
            _identical(stored[key], value[key]) for key in stored)
    if isinstance(value, list):
        return len(stored) == len(value) and all(map(_identical, stored, value))
    if isinstance(value, datetime):
        return _utc(stored) == _utc(value)
    return stored == value


def _bson_kind(value):
    """The BSON type a value is stored as; a subclass (a ``StrEnum`` phase) is its base's."""
    for kind in (bool, int, float, str, dict, list, datetime):
        if isinstance(value, kind):
            return kind
    return type(value)


#: The update operators the shared fakes apply; any other is refused.
_UPDATE_OPERATORS = ("$set", "$unset", "$inc", "$push", "$addToSet", "$pull", "$setOnInsert")


def mongo_update(doc: dict, update: dict, inserting: bool = False) -> dict:
    """The document MongoDB 8.0 stores after applying ``update`` to ``doc``, or ``UnmodelledQuery``
    where the server refuses the update or the fakes do not model it. ``doc`` is left as it was.

    It applies ``$set``, ``$unset``, ``$inc``, ``$push`` (and its ``$each``), ``$addToSet`` (and
    its ``$each``), ``$pull`` (of a value, or an equality condition on sub-document elements) and,
    when ``inserting``, ``$setOnInsert``, each on dotted paths through sub-documents and list
    indexes. As the server does, it applies the paths in the order of their names, so new fields
    land in that order; pads a list with null to reach an index; refuses a field made under a
    scalar or by name in a list, a path under two operators or beside its parent, and any change
    of the ``_id``. Every other operator (``$rename``, ``$min``, ``$pullAll``, a positional path,
    ``$push``'s ``$slice`` and ``$position``, ``$pull`` of an operator condition) is refused,
    naming it.

    Every shared fake that writes goes through this, so a fake's update is the one checked by
    ``tests/mongo_cases.py``'s ``UPDATE_CASES``, hermetically and against the server; a change
    here comes with its cases there.
    """
    reject_malformed_update(update)
    if not any(key.startswith("$") for key in update):
        raise ValueError("update only works with $ operators")
    steps = []
    for operator, fields in update.items():
        if operator not in _UPDATE_OPERATORS:
            _refuse(f"the update operator {operator!r}")
        for path, argument in fields.items():
            parts = path.split(".")
            if any(not part for part in parts):
                _refuse(f"the update path {path!r}, with an empty field name")
            if any(part.startswith("$") for part in parts):
                _refuse(f"the positional update path {path!r}")
            steps.append((parts, operator, argument, path))
    _refuse_conflicts([parts for parts, *_ in steps], [path for *_, path in steps])
    after = copy.deepcopy(doc)
    for parts, operator, argument, path in sorted(steps, key=lambda step: _path_order(step[0])):
        if operator == "$setOnInsert" and not inserting:
            continue
        _apply_one(after, parts, operator, argument, path)
    if "_id" in doc and not _identical(doc["_id"], after.get("_id")):
        _refuse(f"a change of the immutable '_id' (the server refuses it): {update!r}")
    return after


def _path_order(parts):
    """The order the server applies an update's paths in: by name, part by part, a numeric part
    by its number."""
    return [(0, int(part), "") if part.isdigit() else (1, 0, part) for part in parts]


def _refuse_conflicts(paths, names):
    for index, parts in enumerate(paths):
        for other in paths[:index]:
            if parts[:len(other)] == other or other[:len(parts)] == parts:
                _refuse(f"the update path {names[index]!r}, which conflicts with "
                        f"{'.'.join(other)!r} (the server refuses it)")


def _apply_one(doc: dict, parts: list, operator: str, argument, path: str):
    creating = operator not in ("$unset", "$pull")
    parent = doc
    for part in parts[:-1]:
        parent = _step_into(parent, part, creating, path)
        if parent is None:
            return
    last = parts[-1]
    current = _child(parent, last)
    if operator in ("$set", "$setOnInsert"):
        _put(parent, last, copy.deepcopy(argument), path)
    elif operator == "$unset":
        if isinstance(parent, dict):
            parent.pop(last, None)
        elif last.isdigit() and int(last) < len(parent):
            parent[int(last)] = None
    elif operator == "$inc":
        if not _is_number(argument):
            _refuse(f"'$inc' of {path!r} by {argument!r}, not a number (the server refuses it)")
        if current is _MISSING:
            _put(parent, last, argument, path)
        elif _is_number(current):
            _put(parent, last, current + argument, path)
        else:
            _refuse(f"'$inc' of {path!r}, which holds {current!r} (the server refuses it)")
    elif operator in ("$push", "$addToSet"):
        values = _each(operator, argument)
        if current is _MISSING:
            current = []
        elif not isinstance(current, list):
            _refuse(f"{operator!r} onto {path!r}, which holds {current!r} (the server refuses it)")
        else:
            current = list(current)
        for value in values:
            if operator == "$push" or not any(_bson_equal(held, value) for held in current):
                current.append(copy.deepcopy(value))
        _put(parent, last, current, path)
    elif operator == "$pull":
        if current is _MISSING:
            return
        if not isinstance(current, list):
            _refuse(f"'$pull' from {path!r}, which holds {current!r} (the server refuses it)")
        _put(parent, last, [held for held in current if not _pulled(held, argument)], path)


def _step_into(parent, part: str, creating: bool, path: str):
    """The container ``part`` of a path reaches from ``parent``, made where ``creating`` and it is
    missing, or ``None`` where it is missing and not to be made."""
    child = _child(parent, part)
    if isinstance(child, (dict, list)):
        return child
    if child is _MISSING and creating:
        _put(parent, part, {}, path)
        return _child(parent, part)
    if child is _MISSING or not creating:
        return None
    _refuse(f"the update path {path!r}, which runs into {child!r} (the server refuses it)")


def _child(parent, part: str):
    if isinstance(parent, dict):
        return parent.get(part, _MISSING)
    if part.isdigit() and int(part) < len(parent):
        return parent[int(part)]
    return _MISSING


def _put(parent, part: str, value, path: str):
    if isinstance(parent, dict):
        parent[part] = value
        return
    if not part.isdigit():
        _refuse(f"the update path {path!r}, a field by name in a list (the server refuses it)")
    index = int(part)
    parent.extend([None] * (index + 1 - len(parent)))
    parent[index] = value


def _each(operator: str, argument) -> list:
    """The values ``$push`` or ``$addToSet`` adds: the ``$each`` list, or the one value."""
    if isinstance(argument, dict) and any(key.startswith("$") for key in argument):
        modifiers = [key for key in argument if key != "$each"]
        if modifiers:
            _refuse(f"{operator!r} with the modifier {modifiers[0]!r}")
        if not isinstance(argument["$each"], list):
            _refuse(f"{operator!r} with an '$each' that is not a list")
        return argument["$each"]
    return [argument]


def _pulled(held, argument) -> bool:
    """Whether ``$pull`` of ``argument`` takes the element ``held``: an equal value, or, for a
    condition without operators, a sub-document element meeting it."""
    if isinstance(argument, dict) and argument:
        first = next(iter(argument))
        if first.startswith("$"):
            _refuse(f"'$pull' of the operator condition {first!r}")
        return isinstance(held, dict) and mongo_matches(held, argument)
    return _bson_equal(held, argument)


def mongo_upsert_document(query: dict, update: dict) -> dict:
    """The document an upsert that matched nothing makes, as MongoDB 8.0 makes it: the filter's
    equality terms (plain values and ``$eq``, other operators dropped, a dotted path expanded into
    its sub-document), then the update applied as an insert, ``$setOnInsert`` included, and an
    ``ObjectId`` ``_id`` first when neither named one.

    The server lays the filter's terms out in its query planner's order, which this does not model
    (it keeps the filter's); a top-level ``$and``, ``$or`` or ``$nor`` and an ``$in`` (whose one
    value the server takes as equality) are refused.
    """
    made: dict = {}
    for key, condition in query.items():
        if key.startswith("$"):
            _refuse(f"an upsert whose filter holds {key!r}")
        if isinstance(condition, dict) and condition and next(iter(condition)).startswith("$"):
            if "$in" in condition:
                _refuse(f"an upsert whose filter holds '$in' on {key!r}")
            if "$eq" not in condition:
                continue
            condition = condition["$eq"]
        made = mongo_update(made, {"$set": {key: condition}})
    made = mongo_update(made, update, inserting=True)
    if "_id" not in made:
        made = {"_id": _new_object_id(), **made}
    return made


def _new_object_id():
    """A fresh ``ObjectId``, or on the stubbed run, which has no ``bson``, a fresh string."""
    if "bson" in STUBBED_MODULES:
        return uuid.uuid4().hex[:24]
    from bson import ObjectId

    return ObjectId()


#: The order the server sorts values of different types in, lowest first: null and a missing
#: field alike, then numbers, strings, ``ObjectId``s, booleans, dates.
_SORT_BRACKETS = (
    (lambda value: value is None or value is _MISSING, 0),
    (_is_number, 1),
    (lambda value: isinstance(value, str), 2),
    (lambda value: type(value).__name__ == "ObjectId", 7),
    (lambda value: isinstance(value, bool), 8),
    (lambda value: isinstance(value, datetime), 9),
)


def _sort_value(doc: dict, path: str):
    """The value ``path`` sorts ``doc`` by, as ``(bracket, value)``; a list or a sub-document is
    refused, since the server sorts those by rules the fakes do not model."""
    value = doc
    for part in path.split("."):
        if isinstance(value, list):
            _refuse(f"a sort by {path!r} through a list")
        value = value.get(part, _MISSING) if isinstance(value, dict) else _MISSING
    if isinstance(value, list):
        _refuse(f"a sort by {path!r}, which holds a list")
    if isinstance(value, dict):
        _refuse(f"a sort by {path!r}, which holds a document")
    for holds, bracket in _SORT_BRACKETS:
        if holds(value):
            if bracket == 0:
                return (0, 0)
            return (bracket, _utc(value) if isinstance(value, datetime) else value)
    _refuse(f"a sort by {path!r}, which holds {value!r}")


def _sort_spec(key_or_list, direction=None) -> list:
    """A cursor's sort as ``[(path, direction)]``, from either form the driver takes."""
    if isinstance(key_or_list, str):
        keys = [(key_or_list, 1 if direction is None else direction)]
    elif isinstance(key_or_list, (list, tuple)) and direction is None:
        keys = [tuple(pair) for pair in key_or_list]
    else:
        _refuse(f"the sort {key_or_list!r}, {direction!r}")
    for path, way in keys:
        if isinstance(way, bool) or way not in (1, -1):
            _refuse(f"the sort direction {way!r} of {path!r}")
    return keys


def mongo_sorted(docs: list, keys: list) -> list:
    """``docs`` in the order a server's sort by ``keys`` (``[(path, 1 or -1)]``) hands them back:
    null and missing first, then by type bracket, then by value. Ties keep their order, where the
    server promises none, so a case asserting an order breaks every tie."""
    def compare(left, right):
        for path, direction in keys:
            a, b = _sort_value(left, path), _sort_value(right, path)
            if a != b:
                return direction if a > b else -direction
        return 0

    for doc in docs:
        for path, _direction in keys:
            _sort_value(doc, path)
    return sorted(docs, key=functools.cmp_to_key(compare))


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
    """A fake ``find``'s cursor: it sorts, limits and projects when it is read, as the driver's
    does, whatever order ``sort`` and ``limit`` were called in, and hands back copies."""

    def __init__(self, documents, projection=None):
        self._documents = documents
        self._projection = projection
        self._keys = None
        self._limit = 0
        self._read = None

    def sort(self, key_or_list, direction=None):
        self._keys = _sort_spec(key_or_list, direction)
        return self

    def limit(self, n):
        if isinstance(n, bool) or not isinstance(n, int) or n < 0:
            _refuse(f"the limit {n!r}")
        self._limit = n
        return self

    def __iter__(self):
        return self

    def __next__(self):
        if self._read is None:
            documents = self._documents
            if self._keys:
                documents = mongo_sorted(documents, self._keys)
            if self._limit:
                documents = documents[:self._limit]
            self._read = iter([mongo_project(copy.deepcopy(document), self._projection)
                               for document in documents])
        return next(self._read)


class FakeApplicationsCollection:
    """Stand-in for the applications collection, and for every record kept beside a market.

    It writes, reads and projects as MongoDB 8.0 does for what it models, and refuses the rest
    with ``UnmodelledQuery``: filters through ``mongo_matches`` (refused even over no documents),
    updates through ``mongo_update``, an upsert's new document through ``mongo_upsert_document``,
    sorts through ``mongo_sorted`` and projections through ``mongo_project``. It answers the
    server's ``matched_count`` and ``modified_count`` (modified only when a value changed),
    stores a copy of what it is given and hands back copies, adds an ``ObjectId`` ``_id`` to an
    inserted document as the driver does, and refuses a second document with one ``_id``. Each of
    those is checked by ``tests/mongo_cases.py``'s tables, hermetically and against the server.

    It has no unique index but the ``_id``'s and no TTL: ``create_index`` answers a name and does
    nothing. A test of the create race raises ``DuplicateKeyError`` the way the index does (see
    ``TestCreatingAnApplicationConcurrently``), or runs on the server in ``tests/real_mongo/``.
    Tests that only care that *some* applications exist can set ``count`` instead; ``documents``
    is the store itself, and an update changes a stored document in place.
    """

    def __init__(self, count: int = 0):
        self.count = count
        self.documents: list = []

    def create_index(self, *_args, **_kwargs):
        return "fake-index"

    def _matching(self, query) -> list:
        query = {} if query is None else query
        mongo_matches({}, query)  # an unmodelled filter is refused even when nothing is stored
        return [doc for doc in self.documents if mongo_matches(doc, query)]

    def _first(self, query, sort=None):
        matching = self._matching(query)
        if sort is not None:
            matching = mongo_sorted(matching, _sort_spec(sort))
        return matching[0] if matching else None

    def find_one(self, query=None, projection=None, sort=None):
        doc = self._first(query, sort)
        return None if doc is None else mongo_project(copy.deepcopy(doc), projection)

    def find(self, query=None, projection=None):
        return _SortableCursor(self._matching(query), projection)

    def _store(self, document: dict):
        if "_id" in document and any(
                "_id" in held and _bson_equal(held["_id"], document["_id"])
                for held in self.documents):
            from pymongo.errors import DuplicateKeyError

            raise DuplicateKeyError(f"E11000 duplicate key error: _id {document['_id']!r}")
        self.documents.append(copy.deepcopy(document))

    def insert_one(self, document):
        if "_id" not in document:
            document["_id"] = _new_object_id()
        self._store(document)
        return SimpleNamespace(inserted_id=document["_id"], acknowledged=True)

    def _write(self, query, update, upsert, sort=None):
        """Apply ``update`` to the first document ``query`` matches, or upsert one: the document
        as it was (``None`` when made) and as it is, and whether one was made."""
        doc = self._first(query, sort)
        if doc is None:
            mongo_update({}, update)  # a refused update is refused whether or not it upserts
            if not upsert:
                return None, None, False
            made = mongo_upsert_document(query or {}, update)
            self._store(made)
            return None, made, True
        after = mongo_update(doc, update)
        before = copy.deepcopy(doc)
        doc.clear()
        doc.update(after)
        return before, doc, False

    def update_one(self, query, update, upsert=False):
        before, after, made = self._write(query, update, upsert)
        if made:
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=after["_id"])
        if before is None:
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)
        return SimpleNamespace(matched_count=1, modified_count=int(not _identical(before, after)),
                               upserted_id=None)

    def find_one_and_update(self, query, update, projection=None, sort=None, upsert=False,
                            return_document=False):
        """``return_document`` is the driver's ``ReturnDocument``: ``BEFORE`` is ``False`` and
        ``AFTER`` is ``True``, on the real driver and the stub alike."""
        before, after, _made = self._write(query, update, upsert, sort)
        returned = after if return_document else before
        return None if returned is None else mongo_project(copy.deepcopy(returned), projection)

    def _remove(self, doomed: list):
        # By identity and in place: two stored documents may be equal, and a test may hold the list.
        self.documents[:] = [doc for doc in self.documents
                             if all(doc is not gone for gone in doomed)]

    def delete_one(self, query):
        doc = self._first(query)
        self._remove([] if doc is None else [doc])
        return SimpleNamespace(deleted_count=0 if doc is None else 1)

    def delete_many(self, query):
        doomed = self._matching(query)
        self._remove(doomed)
        return SimpleNamespace(deleted_count=len(doomed))

    def count_documents(self, query):
        return self.count + len(self._matching(query))


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
