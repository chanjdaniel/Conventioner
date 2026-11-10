"""The real-MongoDB suite's harness, without a server (``tests/real_mongo/harness.py``).

Which server it runs on and which it refuses, before any connection; the walk that binds every
back-end handle to a test's database; the boot's index list against ``app.py``; and the two ways
it makes requests meet.
"""
import ast
import os
import subprocess
import sys
import threading
import types

import pytest

from conftest import BACK_END_DIR, skip_without_real_dependencies

skip_without_real_dependencies()

from gridfs import GridFS  # noqa: E402
from pymongo import MongoClient  # noqa: E402
from pymongo.collection import Collection  # noqa: E402

import db_config  # noqa: E402
from real_mongo import harness  # noqa: E402

CI_SERVICE = "mongodb://127.0.0.1:27117/?serverSelectionTimeoutMS=5000"
A_WORKTREE_STACK = "mongodb://admin:secret@127.0.0.1:27107/?authSource=admin"


class TestWhichServer:
    def test_unset_every_test_skips_saying_where_the_tests_run(self):
        assert harness.the_server({}) == harness.Server(skip=harness.NOT_SET)
        assert harness.NOT_SET == (
            "REAL_MONGODB_URI is not set: the real-MongoDB tests run in CI's backend job")

    @pytest.mark.parametrize("flag", ["true", "TRUE", "1"])
    def test_unset_while_required_every_test_fails(self, flag):
        assert harness.the_server({"REAL_MONGODB_REQUIRED": flag}) == harness.Server(
            fail="REAL_MONGODB_REQUIRED is set but REAL_MONGODB_URI is not")

    def test_required_but_false_still_skips(self):
        assert harness.the_server({"REAL_MONGODB_REQUIRED": "false"}).skip == harness.NOT_SET

    @pytest.mark.parametrize("uri", [CI_SERVICE, A_WORKTREE_STACK, "mongodb://localhost:27117",
                                     "mongodb://[::1]:27117/"])
    def test_a_loopback_test_server_is_used(self, uri):
        assert harness.the_server({"REAL_MONGODB_URI": uri}) == harness.Server(uri=uri)


class TestWhatIsRefused:
    def test_a_hosted_cluster_by_dns(self):
        refusal = harness.server_refusal("mongodb+srv://cluster0.example.mongodb.net/")
        assert "mongodb+srv:// URI names a hosted cluster" in refusal

    @pytest.mark.parametrize("uri, host", [
        ("mongodb://db.example.com:27117/", "db.example.com"),
        ("mongodb://10.0.0.5:27117/", "10.0.0.5"),
        ("mongodb://127.0.0.1:27117,db.example.com:27117/?replicaSet=rs0", "db.example.com"),
    ])
    def test_a_host_that_is_not_loopback(self, uri, host):
        assert f"{host} is not a loopback address" in harness.server_refusal(uri)

    @pytest.mark.parametrize("uri, target", [
        ("mongodb://127.0.0.1:27017/", "127.0.0.1:27017"),
        ("mongodb://admin:secret@localhost/?authSource=admin", "localhost:27017"),
        ("mongodb://[::1]:27017", "::1:27017"),
    ])
    def test_the_primary_checkouts_stack(self, uri, target):
        assert f"{target} is the primary checkout's stack's MongoDB" in harness.server_refusal(uri)

    def test_a_string_that_names_no_host(self):
        assert "not a mongodb:// connection string" in harness.server_refusal("127.0.0.1:27117")

    def test_a_refusal_fails_the_suite(self):
        server = harness.the_server({"REAL_MONGODB_URI": "mongodb://127.0.0.1:27017/",
                                     "REAL_MONGODB_REQUIRED": "true"})
        assert server.uri is None and "primary checkout" in server.fail

    def test_a_refusal_never_repeats_a_password(self):
        refusal = harness.server_refusal("mongodb://admin:hunter22@db.example.com:27117/")
        assert "hunter22" not in refusal

    def test_the_primary_stack_is_the_database_modules_own(self):
        # One parser decides what the primary stack is: the one `require_named_database` reads.
        assert db_config.uri_targets("mongodb://u:p@127.0.0.1,[::1]:27107/x?y=1") == [
            ("127.0.0.1", db_config.PRIMARY_STACK_PORT), ("::1", 27107)]
        assert db_config.uri_targets("mongodb+srv://cluster0.example.mongodb.net/") == []


def _run_the_package(**environ):
    """``pytest tests/real_mongo`` in a process of its own, with only ``environ`` of the suite's
    two variables set."""
    env = {key: value for key, value in os.environ.items()
           if key not in (harness.URI_VARIABLE, harness.REQUIRED_VARIABLE)}
    env.update(environ)
    return subprocess.run(
        [sys.executable, "-m", "pytest", "tests/real_mongo", "-q", "-rsfE", "-p", "no:cacheprovider"],
        cwd=BACK_END_DIR, env=env, capture_output=True, text=True, timeout=300,
    )


class TestThePackageAnswersTheEnvironment:
    """The whole package, run as a developer or CI would run it, without a server."""

    def test_unset_every_test_skips(self):
        run = _run_the_package()
        assert run.returncode == 0, run.stdout + run.stderr
        assert harness.NOT_SET in run.stdout
        assert " passed" not in run.stdout and " failed" not in run.stdout

    def test_unset_while_required_every_test_fails(self):
        run = _run_the_package(REAL_MONGODB_REQUIRED="true")
        assert run.returncode == 1, run.stdout + run.stderr
        assert harness.REQUIRED_BUT_NOT_SET in run.stdout
        assert " passed" not in run.stdout and " skipped" not in run.stdout

    def test_a_refused_server_fails_every_test_before_any_connection(self):
        # A client for this URI would look its name up in DNS as it is made; the refusal comes first.
        run = _run_the_package(REAL_MONGODB_URI="mongodb+srv://cluster0.nothing-here.invalid/")
        assert run.returncode == 1, run.stdout + run.stderr
        assert "a mongodb+srv:// URI names a hosted cluster" in run.stdout
        assert "ConfigurationError" not in run.stdout + run.stderr
        assert " passed" not in run.stdout


class TestTheDatabaseName:
    def test_it_is_the_prefix_and_twelve_hex_characters(self):
        names = {harness.fresh_database_name() for _ in range(50)}
        assert len(names) == 50
        for name in names:
            assert name.startswith("real_mongo_")
            suffix = name[len("real_mongo_"):]
            assert len(suffix) == 12 and int(suffix, 16) >= 0


@pytest.fixture
def unreachable():
    """A client that never connects: making handles over it does no I/O."""
    client = MongoClient("mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=100", connect=False)
    yield client
    client.close()


def _a_back_end_module(monkeypatch, name, relative_path, **attributes):
    module = types.ModuleType(name)
    module.__file__ = os.path.join(BACK_END_DIR, relative_path)
    for attribute, value in attributes.items():
        setattr(module, attribute, value)
    monkeypatch.setitem(sys.modules, name, module)
    return module


class FakeHandle:
    """A test's stand-in for a collection."""


class TestTheHandleWalk:
    def test_it_walks_the_back_end_and_not_the_tests_migrations_or_packages(self, monkeypatch):
        inside = _a_back_end_module(monkeypatch, "walk_probe_inside", "walk_probe_inside.py")
        nested = _a_back_end_module(monkeypatch, "walk_probe.nested", "api/walk_probe_nested.py")
        a_test = _a_back_end_module(monkeypatch, "walk_probe_test", "tests/walk_probe_test.py")
        a_migration = _a_back_end_module(monkeypatch, "walk_probe_migration",
                                         "migrations/walk_probe_migration.py")
        a_package = _a_back_end_module(monkeypatch, "walk_probe_package",
                                       ".venv/lib/python3.12/site-packages/walk_probe_package.py")

        walked = harness.back_end_modules()

        assert inside in walked and nested in walked
        assert a_test not in walked and a_migration not in walked and a_package not in walked

    def test_every_handle_is_bound_by_its_type(self, monkeypatch, unreachable):
        old = unreachable["conventioner"]
        test_db = unreachable["real_mongo_0123456789ab"]
        module = _a_back_end_module(
            monkeypatch, "walk_probe_handles", "walk_probe_handles.py",
            db=old, any_name_at_all=old["markets"], _fs=GridFS(old, collection="floorplan_images"),
            get_database=db_config.get_database, not_a_handle="markets",
        )

        harness.bind_handles(test_db, monkeypatch, modules=[module])

        assert module.db is test_db
        assert isinstance(module.any_name_at_all, Collection)
        assert module.any_name_at_all.full_name == "real_mongo_0123456789ab.markets"
        assert module._fs._collection.full_name == "real_mongo_0123456789ab.floorplan_images"
        assert module.get_database() is test_db and module.get_database("conventioner") is test_db
        assert module.not_a_handle == "markets"
        assert harness.stray_handles(test_db, [module]) == []

    def test_binding_returns_every_handle_after_the_test(self, monkeypatch, unreachable):
        old = unreachable["conventioner"]
        module = _a_back_end_module(monkeypatch, "walk_probe_undo", "walk_probe_undo.py", db=old)
        with pytest.MonkeyPatch.context() as binding:
            harness.bind_handles(unreachable["real_mongo_0123456789ab"], binding, modules=[module])
            assert module.db is not old
        assert module.db is old

    def test_a_stand_in_is_put_back_and_then_bound(self, monkeypatch, unreachable):
        old = unreachable["conventioner"]
        test_db = unreachable["real_mongo_0123456789ab"]
        module = _a_back_end_module(monkeypatch, "walk_probe_stand_in", "walk_probe_stand_in.py",
                                    users_collection=FakeHandle())

        harness.bind_handles(test_db, monkeypatch,
                             {("walk_probe_stand_in", "users_collection"): old["users"]},
                             modules=[module])

        assert module.users_collection.full_name == "real_mongo_0123456789ab.users"

    def test_a_handle_on_another_client_or_a_tests_stand_in_is_named(self, unreachable):
        test_db = unreachable["real_mongo_0123456789ab"]
        other = MongoClient("mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=100", connect=False)
        try:
            module = types.SimpleNamespace(
                __name__="walk_probe_stray", other_client=other["real_mongo_0123456789ab"],
                other_database=unreachable["conventioner"]["markets"], fake=FakeHandle(),
                fake_class=FakeHandle, bound=test_db["markets"])
            assert harness.stray_handles(test_db, [module]) == [
                "walk_probe_stray.fake (a test's stand-in)",
                "walk_probe_stray.other_client",
                "walk_probe_stray.other_database",
            ]
        finally:
            other.close()

    def test_binding_refuses_to_leave_a_stand_in(self, monkeypatch, unreachable):
        module = _a_back_end_module(monkeypatch, "walk_probe_left", "walk_probe_left.py",
                                    users_collection=FakeHandle())
        with pytest.raises(AssertionError, match="walk_probe_left.users_collection"):
            harness.bind_handles(unreachable["real_mongo_0123456789ab"], monkeypatch,
                                 modules=[module])


def _calls_in_the_boot():
    """Every ``ensure_*`` function ``app.py`` calls at module level or in its boot checks, as
    ``(module, function)``, the module resolved through ``app.py``'s imports."""
    tree = ast.parse(open(os.path.join(BACK_END_DIR, "app.py")).read())
    modules = {}
    for node in tree.body:
        if isinstance(node, ast.Import):
            for alias in node.names:
                modules[alias.asname or alias.name] = alias.name
        elif isinstance(node, ast.ImportFrom) and node.module:
            for alias in node.names:
                modules[alias.asname or alias.name] = (node.module, alias.name)
    calls = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if isinstance(func, ast.Attribute) and func.attr.startswith("ensure_"):
            if isinstance(func.value, ast.Name):
                calls.add((modules.get(func.value.id, func.value.id), func.attr))
        elif isinstance(func, ast.Name) and func.id.startswith("ensure_"):
            imported = modules.get(func.id)
            calls.add(imported if isinstance(imported, tuple) else ("app", func.id))
    return calls


class TestTheBootsIndexes:
    def test_the_list_holds_every_ensure_the_boot_calls(self):
        calls = _calls_in_the_boot()
        assert calls, "app.py's boot calls no ensure_* function, so this test reads nothing"
        assert calls <= set(harness.BOOT_INDEX_BUILDS), (
            f"app.py's boot calls {sorted(calls - set(harness.BOOT_INDEX_BUILDS))}, which "
            "tests/real_mongo/harness.py's BOOT_INDEX_BUILDS lacks")

    def test_every_listed_build_is_a_function(self):
        import importlib

        for module, function in harness.BOOT_INDEX_BUILDS:
            assert callable(getattr(importlib.import_module(module), function))


def _a_probe_module(monkeypatch, read):
    module = types.ModuleType("interleave_probe")
    module.read = read
    monkeypatch.setitem(sys.modules, "interleave_probe", module)
    return module


class TestInterleave:
    def test_then_lands_once_after_the_first_call_returns(self, monkeypatch):
        events = []

        def read(n):
            events.append(f"read {n}")
            return n * 10

        module = _a_probe_module(monkeypatch, read)
        harness.interleave(monkeypatch, "interleave_probe.read", lambda: events.append("then"))

        assert module.read(1) == 10
        assert module.read(2) == 20
        assert events == ["read 1", "then", "read 2"]

    def test_the_original_is_back_after_the_test(self, monkeypatch):
        def read():
            return "read"

        module = _a_probe_module(monkeypatch, read)
        with pytest.MonkeyPatch.context() as patch:
            harness.interleave(patch, "interleave_probe.read", lambda: None)
            assert module.read is not read
        assert module.read is read

    def test_a_target_that_does_not_exist_is_refused(self, monkeypatch):
        _a_probe_module(monkeypatch, lambda: None)
        with pytest.raises(AttributeError):
            harness.interleave(monkeypatch, "interleave_probe.write", lambda: None)
        with pytest.raises(ImportError):
            harness.interleave(monkeypatch, "no_such_module_anywhere.read", lambda: None)


class TestRace:
    def test_every_thread_is_released_together(self):
        n = 8
        all_inside = threading.Barrier(n, timeout=10)

        def fn(i):
            # Passes only when all n are inside fn at once: one at a time, the first waits alone.
            all_inside.wait()
            return threading.get_ident()

        results = harness.race(n, fn)

        assert len(set(results)) == n

    def test_each_result_or_exception_is_handed_back_in_order(self):
        def fn(i):
            if i == 2:
                raise ValueError("two")
            return i

        results = harness.race(4, fn)

        assert results[:2] == [0, 1] and results[3] == 3
        assert isinstance(results[2], ValueError) and str(results[2]) == "two"
