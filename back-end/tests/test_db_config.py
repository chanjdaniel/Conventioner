"""Where the database handle comes from, and how often.

A ``MongoClient`` is a connection pool with its own background monitoring threads, and nothing in
this application ever closes one. Building one per request therefore leaks a pool and its threads
for the life of the process. Most API modules called ``get_database()`` once at import;
``api/applicants.py`` called it inside four request handlers, so every public applicant request
leaked one.
"""
import time

import db_config
import pytest

from conftest import STUBBED_MODULES


class TestTheDefaultClientIsMadeOnce:
    def _count_clients(self, monkeypatch):
        made = []

        class _FakeClient(dict):
            def __init__(self, name):
                super().__init__()
                self.name = name

            def __getitem__(self, db_name):
                return f"{self.name}:{db_name}"

        def _fake(server_selection_timeout_ms=None):
            made.append(server_selection_timeout_ms)
            return _FakeClient(f"client-{len(made)}")

        monkeypatch.setattr(db_config, "get_mongodb_client", _fake)
        monkeypatch.setattr(db_config, "_default_clients", {})
        return made

    def test_repeated_calls_reuse_one_client(self, monkeypatch):
        made = self._count_clients(monkeypatch)

        handles = [db_config.get_database() for _ in range(25)]

        assert len(made) == 1, "a client per call is a connection pool per call"
        assert len(set(handles)) == 1

    def test_a_different_database_gets_its_own_client(self, monkeypatch):
        made = self._count_clients(monkeypatch)

        db_config.get_database("conventioner")
        db_config.get_database("something_else")
        db_config.get_database("conventioner")

        assert len(made) == 2

    def test_a_caller_asking_for_its_own_timeout_gets_a_fresh_client(self, monkeypatch):
        """The startup migration probe wants a short-lived, time-bounded handle, and runs once."""
        made = self._count_clients(monkeypatch)

        db_config.get_database(server_selection_timeout_ms=3000)
        db_config.get_database(server_selection_timeout_ms=3000)

        assert made == [3000, 3000]

    def test_the_probe_never_becomes_the_memoized_default(self, monkeypatch):
        """A three-second selection timeout is right for a boot probe and wrong for everything
        after it, so it must not be what every later request inherits."""
        made = self._count_clients(monkeypatch)

        db_config.get_database(server_selection_timeout_ms=3000)
        db_config.get_database()

        assert made == [3000, None]


class TestAFixtureScriptReachesOnlyTheDatabaseItIsTold:
    """``require_named_database``: a script that resets or seeds test data never reaches the primary
    checkout's stack, 127.0.0.1:27017 on a developer's machine, by default or by a stale value."""

    VARIABLES = ("MONGODB_URI", "MONGODB_HOST", "MONGODB_PORT", "ALLOW_PRIMARY_STACK")

    def _environment(self, monkeypatch, **values):
        for name in self.VARIABLES:
            monkeypatch.delenv(name, raising=False)
        for name, value in values.items():
            monkeypatch.setenv(name, value)

    def test_nothing_named_is_refused(self, monkeypatch):
        self._environment(monkeypatch)
        with pytest.raises(SystemExit) as refused:
            db_config.require_named_database()
        assert "MONGODB_HOST" in str(refused.value)

    @pytest.mark.parametrize("values", [
        {"MONGODB_HOST": "127.0.0.1"},
        {"MONGODB_HOST": "127.0.0.1", "MONGODB_PORT": "27017"},
        {"MONGODB_HOST": "localhost"},
        {"MONGODB_HOST": "localhost", "MONGODB_PORT": "27017"},
        {"MONGODB_HOST": "::1"},
        {"MONGODB_URI": "mongodb://admin:secret@127.0.0.1:27017/admin"},
        {"MONGODB_URI": "mongodb://localhost/conventioner"},
    ], ids=["loopback", "loopback-27017", "localhost", "localhost-27017", "ipv6-loopback", "uri-27017", "uri-default-port"])
    def test_the_primary_stack_s_mongodb_is_refused(self, monkeypatch, values):
        self._environment(monkeypatch, **values)
        with pytest.raises(SystemExit) as refused:
            db_config.require_named_database()
        assert "primary checkout's stack" in str(refused.value)
        assert "ALLOW_PRIMARY_STACK" in str(refused.value)

    @pytest.mark.parametrize("values", [
        {"MONGODB_HOST": "mongodb"},
        {"MONGODB_HOST": "mongodb", "MONGODB_PORT": "27017"},
        {"MONGODB_HOST": "127.0.0.1", "MONGODB_PORT": "27037"},
        {"MONGODB_URI": "mongodb://admin:secret@127.0.0.1:27037/admin"},
        {"MONGODB_URI": "mongodb+srv://someone:secret@cluster.example.net"},
        {"MONGODB_HOST": "127.0.0.1", "ALLOW_PRIMARY_STACK": "true"},
    ], ids=["container", "container-27017", "slot-2", "uri-slot-2", "hosted", "opted-in"])
    def test_a_named_database_passes(self, monkeypatch, values):
        self._environment(monkeypatch, **values)
        db_config.require_named_database()


@pytest.mark.skipif("pymongo" in STUBBED_MODULES, reason="reads the real driver's options")
class TestEveryClientHasBounds:
    """``get_mongodb_client``: every client finds a server within 5 seconds, gives up on any one
    wait for the server's reply after 30, keeps at most 20 connections and closes one idle for a minute, whatever
    ``MONGODB_URI`` says; the boot probe's client finds a server within 3.

    Read from the real driver's own ``options``, against a closed loopback port, so no test here
    reaches a database. Each client a test builds is closed."""

    CLOSED_PORT = "mongodb://127.0.0.1:1/"
    VARIABLES = ("MONGODB_URI", "MONGODB_HOST", "MONGODB_PORT")

    @pytest.fixture
    def clients(self):
        built = []
        yield built
        for client in built:
            client.close()

    def _environment(self, monkeypatch, **values):
        for name in self.VARIABLES:
            monkeypatch.delenv(name, raising=False)
        for name, value in values.items():
            monkeypatch.setenv(name, value)

    @staticmethod
    def _bounds(client):
        options = client.options
        return {
            "server selection": options.server_selection_timeout,
            "connect": options.pool_options.connect_timeout,
            "reply": options.pool_options.socket_timeout,
            "operation": options.timeout,
            "pool": options.pool_options.max_pool_size,
            "idle": options.pool_options.max_idle_time_seconds,
        }

    @pytest.mark.parametrize("values", [
        {"MONGODB_URI": CLOSED_PORT},
        {"MONGODB_HOST": "127.0.0.1", "MONGODB_PORT": "1"},
    ], ids=["uri", "host-and-port"])
    def test_a_built_client_has_every_bound(self, monkeypatch, clients, values):
        self._environment(monkeypatch, **values)
        clients.append(db_config.get_mongodb_client())

        assert self._bounds(clients[-1]) == {
            "server selection": 5.0, "connect": 5.0, "reply": 30.0, "operation": None, "pool": 20, "idle": 60.0,
        }

    def test_the_default_handle_has_every_bound(self, monkeypatch, clients):
        self._environment(monkeypatch, MONGODB_URI=self.CLOSED_PORT)
        monkeypatch.setattr(db_config, "_default_clients", {})
        clients.append(db_config.get_database().client)

        assert self._bounds(clients[-1])["pool"] == 20
        assert self._bounds(clients[-1])["reply"] == 30.0

    @staticmethod
    def _probe_client():
        """The boot probe's client, as ``get_migration_probe_database`` builds it; conftest replaces
        that function for the whole suite, so app.py's import never waits on a database."""
        return db_config.get_database(
            server_selection_timeout_ms=db_config.MIGRATION_PROBE_TIMEOUT_MS
        ).client

    def test_the_probe_finds_a_server_within_three_seconds_and_keeps_the_other_bounds(
        self, monkeypatch, clients
    ):
        self._environment(monkeypatch, MONGODB_URI=self.CLOSED_PORT)
        clients.append(self._probe_client())

        assert self._bounds(clients[-1]) == {
            "server selection": 3.0, "connect": 5.0, "reply": 30.0, "operation": None, "pool": 20, "idle": 60.0,
        }

    def test_the_uri_cannot_widen_a_bound(self, monkeypatch, clients):
        self._environment(
            monkeypatch,
            MONGODB_URI=self.CLOSED_PORT + "?maxPoolSize=100&serverSelectionTimeoutMS=30000"
            "&socketTimeoutMS=600000&maxIdleTimeMS=600000&connectTimeoutMS=20000",
        )
        clients.append(db_config.get_mongodb_client())

        assert self._bounds(clients[-1]) == {
            "server selection": 5.0, "connect": 5.0, "reply": 30.0, "operation": None, "pool": 20, "idle": 60.0,
        }

    def test_the_uri_cannot_set_an_operation_timeout(self, monkeypatch, clients):
        """A client-wide ``timeoutMS`` would make server selection wait out its whole budget."""
        self._environment(monkeypatch, MONGODB_URI=self.CLOSED_PORT + "?timeoutMS=30000")
        clients.append(db_config.get_mongodb_client())

        assert self._bounds(clients[-1])["operation"] is None

    @pytest.mark.parametrize("which, within", [("client", 8), ("probe", 5)])
    def test_a_find_at_a_closed_port_fails_within_seconds(self, monkeypatch, clients, which, within):
        """With the driver's defaults this took about 30 seconds: half a minute of a request,
        or of the boot, held on a database that is not there. A client-wide ``timeoutMS`` of 30
        seconds took as long, the probe's included, since it replaces the selection timeout."""
        from pymongo.errors import PyMongoError

        self._environment(monkeypatch, MONGODB_URI=self.CLOSED_PORT)
        clients.append(db_config.get_mongodb_client() if which == "client" else self._probe_client())
        markets = clients[-1]["conventioner"]["markets"]

        started = time.monotonic()
        with pytest.raises(PyMongoError):
            markets.find_one({"id": "a-market"})
        assert time.monotonic() - started < within
