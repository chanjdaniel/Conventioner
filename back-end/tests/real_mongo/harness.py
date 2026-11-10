"""What the real-MongoDB tests stand on: which server, a database of each test's own, every handle
bound to it, the indexes the boot builds, and two ways to make requests meet.

Kept apart from ``conftest.py`` so the ordinary suite can test it without a server: the refusals,
the handle walk and the boot's index list are each tested there, hermetically.
"""
import importlib
import os
import sys
import threading
import uuid
from typing import Any, Callable, Dict, List, NamedTuple, Optional, Tuple

import db_config
from conftest import BACK_END_DIR

TESTS_DIR = os.path.join(BACK_END_DIR, "tests")

URI_VARIABLE = "REAL_MONGODB_URI"
REQUIRED_VARIABLE = "REAL_MONGODB_REQUIRED"

NOT_SET = "REAL_MONGODB_URI is not set: the real-MongoDB tests run in CI's backend job"
REQUIRED_BUT_NOT_SET = "REAL_MONGODB_REQUIRED is set but REAL_MONGODB_URI is not"

#: Every database a test makes is named this and 12 hex characters, and only such a database it made
#: is ever written or dropped.
DATABASE_PREFIX = "real_mongo_"

class Server(NamedTuple):
    """What the environment asks of the suite: ``uri`` to run on, else why it skips or fails."""

    uri: Optional[str] = None
    skip: Optional[str] = None
    fail: Optional[str] = None


def server_refusal(uri: str) -> Optional[str]:
    """Why ``uri`` is not a server these tests may run on, else None.

    Only a test server on this machine: never a hosted cluster (``mongodb+srv://``), never another
    machine, and never the primary checkout's stack, on loopback port 27017. The hosts are read with
    the database module's own parser (``db_config.uri_targets``), the one ``require_named_database``
    reads, so one parser decides what the primary stack is. The words name a host and port at most,
    never the URI, which may carry a password.
    """
    if uri.startswith("mongodb+srv://"):
        return (f"Refusing {URI_VARIABLE}: a mongodb+srv:// URI names a hosted cluster by DNS, and "
                "the real-MongoDB tests run only on a test server on this machine.")
    targets = db_config.uri_targets(uri)
    if not targets:
        return (f"Refusing {URI_VARIABLE}: it is not a mongodb:// connection string naming a host, "
                "so it names no test server on this machine.")
    for host, port in targets:
        if not db_config.is_loopback(host):
            return (f"Refusing {URI_VARIABLE}: {host} is not a loopback address, and the "
                    "real-MongoDB tests run only on a test server on this machine.")
        if port == db_config.PRIMARY_STACK_PORT:
            return (f"Refusing {URI_VARIABLE}: {host}:{port} is the primary checkout's stack's "
                    "MongoDB. Name a worktree stack's (127.0.0.1:$TH_MONGO_PORT) or CI's service "
                    "(127.0.0.1:27117).")
    return None


def the_server(environ=None) -> Server:
    """The server the environment names for the suite, or why every test skips or fails."""
    environ = os.environ if environ is None else environ
    uri = (environ.get(URI_VARIABLE) or "").strip()
    if not uri:
        if (environ.get(REQUIRED_VARIABLE) or "").strip().lower() in db_config._TRUTHY:
            return Server(fail=REQUIRED_BUT_NOT_SET)
        return Server(skip=NOT_SET)
    refusal = server_refusal(uri)
    if refusal:
        return Server(fail=refusal)
    return Server(uri=uri)


def fresh_database_name() -> str:
    return DATABASE_PREFIX + uuid.uuid4().hex[:12]


class fresh_database:
    """A database of its own on ``client``, dropped on the way out whether the block passed or not.

    It drops the one database it named, and nothing else, so a misdirected run cannot reach another.
    """

    def __init__(self, client):
        self.client = client
        self.name = fresh_database_name()

    def __enter__(self):
        return self.client[self.name]

    def __exit__(self, *_exc):
        assert self.name.startswith(DATABASE_PREFIX)
        self.client.drop_database(self.name)
        return False


# --- Binding every handle ------------------------------------------------------------------------


def back_end_modules() -> List[Any]:
    """Every loaded module of the back end: its file under ``back-end/``, not a test's, not a
    migration's, and not an installed package's (a virtual environment kept under ``back-end/``)."""
    modules = []
    for module in list(sys.modules.values()):
        path = getattr(module, "__file__", None)
        if not path:
            continue
        relative = os.path.relpath(os.path.abspath(path), BACK_END_DIR)
        parts = relative.split(os.sep)
        if parts[0] in ("..", "tests", "migrations") or parts[0].startswith("."):
            continue
        if "site-packages" in parts:
            continue
        modules.append(module)
    return modules


def _handle_types():
    from gridfs import GridFS
    from pymongo.collection import Collection
    from pymongo.database import Database

    return Database, Collection, GridFS


def _the_database_of(handle) -> Any:
    """The ``Database`` a handle reads and writes, or None when it is not a handle."""
    Database, Collection, GridFS = _handle_types()
    if isinstance(handle, Database):
        return handle
    if isinstance(handle, Collection):
        return handle.database
    if isinstance(handle, GridFS):
        return handle._collection.database
    return None


def bound_value(value, db, get_database) -> Tuple[bool, Any]:
    """``(True, the value bound to db)`` when ``value`` is a handle, else ``(False, None)``.

    A handle is found by its type: a ``Database`` is ``db``, a ``Collection`` is ``db``'s of the same
    name, a GridFS store is one over ``db`` with the same collection, and the database module's
    ``get_database`` answers ``db`` whatever it is asked.
    """
    Database, Collection, GridFS = _handle_types()
    if isinstance(value, Database):
        return True, db
    if isinstance(value, Collection):
        return True, db[value.name]
    if isinstance(value, GridFS):
        return True, GridFS(db, collection=value._collection.name)
    if get_database is not None and value is get_database:
        return True, lambda *_args, **_kwargs: db
    return False, None


def _is_a_tests_stand_in(value) -> bool:
    """An object of a class some test file defines: a fake left in a back-end module's attribute."""
    if isinstance(value, type):
        return False
    module = sys.modules.get(type(value).__module__)
    path = getattr(module, "__file__", None) or ""
    return os.path.abspath(path).startswith(TESTS_DIR + os.sep)


def stray_handles(db, modules=None) -> List[str]:
    """Every back-end module attribute that is a handle not on ``db``, or a test's fake standing in
    for one, as ``module.attribute``. Empty once every handle is bound."""
    modules = back_end_modules() if modules is None else modules
    stray = []
    for module in modules:
        for attribute, value in list(vars(module).items()):
            database = _the_database_of(value)
            if database is not None:
                if database.client is not db.client or database.name != db.name:
                    stray.append(f"{module.__name__}.{attribute}")
            elif _is_a_tests_stand_in(value):
                stray.append(f"{module.__name__}.{attribute} (a test's stand-in)")
    return sorted(stray)


def bind_handles(db, monkeypatch, stand_ins: Optional[Dict[Tuple[str, str], Any]] = None,
                 modules=None) -> None:
    """Bind every handle of every loaded back-end module to ``db``, through ``monkeypatch``.

    ``stand_ins`` maps ``(module, attribute)`` to the value a fake replaced at import (the shared
    conftest's ``IMPORT_TIME_STAND_INS``): each is put back first, so it is bound like any other.
    Every binding is a ``monkeypatch.setattr``, so each attribute returns to its import-time value
    after the test. Raises when a handle or a test's stand-in is left over.
    """
    for (module_name, attribute), original in (stand_ins or {}).items():
        monkeypatch.setattr(sys.modules[module_name], attribute, original)
    modules = back_end_modules() if modules is None else modules
    # The walk replaces ``db_config.get_database`` itself, so it is compared against the one read
    # before any module is walked.
    get_database = db_config.get_database
    for module in modules:
        for attribute, value in list(vars(module).items()):
            is_handle, replacement = bound_value(value, db, get_database)
            if is_handle:
                monkeypatch.setattr(module, attribute, replacement)
    stray = stray_handles(db, modules)
    if stray:
        raise AssertionError(f"Left unbound to {db.name}: {', '.join(stray)}")


# --- The boot's indexes --------------------------------------------------------------------------

#: Every ``ensure_*`` function ``app.py``'s boot calls, as ``(module, function)``. A hermetic test
#: runs the boot on the fakes and fails when it calls one this lacks.
BOOT_INDEX_BUILDS: Tuple[Tuple[str, str], ...] = (
    ("api.applications", "ensure_application_indexes"),
    ("api.applicant_auth", "ensure_applicant_login_indexes"),
    ("api.users", "ensure_user_indexes"),
    ("lookup_indexes", "ensure_lookup_indexes"),
)

#: The flags by which a module builds its indexes once a process; the boot under the suite has
#: already set them, against the import-time fakes.
_BUILT_ONCE_FLAGS = (("api.applications", "_indexes_ready"), ("api.applicant_auth", "_indexes_ready"))


def build_boot_indexes(monkeypatch) -> None:
    """Build every index the boot builds, through the boot's own functions, on the bound database."""
    for module_name, flag in _BUILT_ONCE_FLAGS:
        monkeypatch.setattr(importlib.import_module(module_name), flag, False)
    for module_name, function in BOOT_INDEX_BUILDS:
        getattr(importlib.import_module(module_name), function)()


# --- Making requests meet ------------------------------------------------------------------------


def _resolve(target: str) -> Tuple[Any, str]:
    """``"module.attribute"`` (the module path as long as it imports) as ``(owner, attribute)``."""
    parts = target.split(".")
    for split in range(len(parts) - 1, 0, -1):
        try:
            owner = importlib.import_module(".".join(parts[:split]))
        except ImportError:
            continue
        for name in parts[split:-1]:
            owner = getattr(owner, name)
        if not hasattr(owner, parts[-1]):
            raise AttributeError(f"{target}: {owner!r} has no {parts[-1]!r}")
        return owner, parts[-1]
    raise ImportError(f"{target}: no module in it imports")


def interleave(monkeypatch, target: str, then: Callable[[], Any]) -> None:
    """Land ``then()`` right after the first call of ``target`` returns, before its caller goes on.

    ``target`` is ``"module.attribute"``, the function a request reads with; on its first call the
    wrapper calls it, runs ``then()`` once, and hands back what the call returned, so whatever
    ``then`` changes lands between that read and the write after it. A module that imported the
    function by name holds its own reference, so name the attribute the reader calls through.
    """
    owner, attribute = _resolve(target)
    original = getattr(owner, attribute)
    ran = []

    def wrapper(*args, **kwargs):
        result = original(*args, **kwargs)
        if not ran:
            ran.append(True)
            then()
        return result

    monkeypatch.setattr(owner, attribute, wrapper)


#: How long a race waits for its threads, so a deadlock fails the test instead of hanging the run.
RACE_TIMEOUT_SECONDS = 60


def race(n: int, fn: Callable[[int], Any]) -> List[Any]:
    """Run ``fn(i)`` on ``n`` threads released together, and return each result, or the exception it
    raised, in the order of ``i``."""
    barrier = threading.Barrier(n, timeout=RACE_TIMEOUT_SECONDS)
    results: List[Any] = [None] * n

    def run(i):
        try:
            barrier.wait()
            results[i] = fn(i)
        except BaseException as error:  # noqa: B902 - the race hands every outcome back
            results[i] = error

    threads = [threading.Thread(target=run, args=(i,), daemon=True) for i in range(n)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(RACE_TIMEOUT_SECONDS)
    alive = [i for i, thread in enumerate(threads) if thread.is_alive()]
    if alive:
        raise AssertionError(f"race: threads {alive} still running after {RACE_TIMEOUT_SECONDS}s")
    return results


def warm(collection, n: int) -> None:
    """Open ``n`` pooled connections to the server before a race of ``n`` threads, by ``n`` reads
    of ``collection`` at once; a read that fails is raised.

    On a cold pool each racing thread opens and authenticates its own connection first, which
    spreads the threads out until their writes no longer meet: a create race then passed with the
    unique index taken away, until the pool was warmed.
    """
    for result in race(n, lambda _i: collection.find_one({})):
        if isinstance(result, BaseException):
            raise result
