"""Where the database handle comes from, and how often.

A ``MongoClient`` is a connection pool with its own background monitoring threads, and nothing in
this application ever closes one. Building one per request therefore leaks a pool and its threads
for the life of the process. Most API modules called ``get_database()`` once at import;
``api/applicants.py`` called it inside four request handlers, so every public applicant request
leaked one.
"""
import db_config


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
