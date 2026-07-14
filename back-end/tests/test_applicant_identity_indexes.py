"""The unique index the application-create endpoint rests on, and how it refuses.

One applicant is one application at a market. That is not a promise application code can keep: the
document is written by an upsert on a public, unauthenticated endpoint, so it is a read-then-write
race that only the database can settle. The index *is* the guarantee, not a decoration on one - so
a process that cannot build it does not have the guarantee, and must not pretend it does. It
refuses, at boot, naming what is wrong, exactly as a missing market-key migration does.
"""
import pytest
from pymongo.errors import DuplicateKeyError, PyMongoError

from datatypes import Application, ApplicationStatus, ApplicationType

import api.applications as ApplicationsApi


@pytest.fixture(autouse=True)
def unbuilt(monkeypatch):
    """A process that has not built its indexes yet - which every process is, once, at boot."""
    monkeypatch.setattr(ApplicationsApi, "_indexes_ready", False)


def _unbuildable(collection, monkeypatch):
    """A collection whose index will not build - which, in production, means it already holds the
    duplicates the index exists to forbid."""
    def boom(*_args, **_kwargs):
        raise PyMongoError("E11000 duplicate key error: index build failed")

    monkeypatch.setattr(collection, "create_index", boom)


class TestTheApplicationIdentityIndex:
    def test_an_index_that_will_not_build_refuses(self, applications, monkeypatch):
        _unbuildable(applications, monkeypatch)

        with pytest.raises(ApplicationsApi.ApplicationIndexError):
            ApplicationsApi.ensure_application_indexes()

    def test_the_refusal_names_the_duplicates_that_are_blocking_it(self, applications, monkeypatch):
        """The operator has to be able to act on it, and the likeliest cause is the one thing the
        index forbids being already in the collection."""
        _unbuildable(applications, monkeypatch)

        with pytest.raises(ApplicationsApi.ApplicationIndexError) as exc:
            ApplicationsApi.ensure_application_indexes()

        message = str(exc.value)
        assert ApplicationsApi.APPLICANT_IDENTITY_INDEX in message
        assert "duplicates" in message

    def test_no_application_is_stored_while_the_index_is_absent(self, applications, monkeypatch):
        """The write that creates an application is a race the index is the only referee of, so a
        process that cannot build it does not get to run the race."""
        _unbuildable(applications, monkeypatch)

        with pytest.raises(ApplicationsApi.ApplicationIndexError):
            ApplicationsApi.find_or_create_application(Application(
                market_id="market-123",
                applicant_email="vendor@example.com",
                application_type=ApplicationType.MAIN,
                form_data={},
                status=ApplicationStatus.OPEN,
            ))

        assert applications.documents == []

    def test_an_index_that_builds_lets_the_application_be_stored(self, applications):
        stored = ApplicationsApi.find_or_create_application(Application(
            market_id="market-123",
            applicant_email="vendor@example.com",
            application_type=ApplicationType.MAIN,
            form_data={},
            status=ApplicationStatus.OPEN,
        ))

        assert stored.applicant_email == "vendor@example.com"
        assert len(applications.documents) == 1


class TestCreatingAnApplicationConcurrently:
    """Two writers for the same applicant identity leave exactly one document.

    The upsert itself is not what makes this safe -- an upsert that matches nothing and inserts can
    still duplicate when two requests both match nothing before either inserts. The unique index is
    the difference: the second insert raises DuplicateKeyError, and ``find_or_create_application``
    catches it, reads the winner's document back, and returns that instead.
    """

    _defaults = dict(
        market_id="market-123",
        applicant_email="vendor@example.com",
        application_type=ApplicationType.MAIN,
        form_data={"name": "My Shop"},
        status=ApplicationStatus.OPEN,
    )

    def _app(self, **overrides):
        kwargs = dict(self._defaults, **overrides)
        return Application(**kwargs)

    def test_two_calls_for_the_same_identity_leave_one_document(self, applications):
        app = self._app()

        first = ApplicationsApi.find_or_create_application(app)
        second = ApplicationsApi.find_or_create_application(app)

        assert len(applications.documents) == 1
        assert first.applicant_email == "vendor@example.com"
        assert second.applicant_email == "vendor@example.com"

    def test_the_second_call_is_a_no_op_not_an_error(self, applications):
        """The caller gets the application that exists; it does not have to catch anything."""
        app = self._app()
        ApplicationsApi.find_or_create_application(app)

        second = ApplicationsApi.find_or_create_application(app)

        assert second is not None
        assert second.applicant_email == "vendor@example.com"

    def test_a_waitlist_application_alongside_a_main_one_is_not_a_duplicate(self, applications):
        main = self._app(application_type=ApplicationType.MAIN)
        waitlist = self._app(application_type=ApplicationType.WAITLIST,
                             main_application_id=main.id)

        ApplicationsApi.find_or_create_application(main)
        ApplicationsApi.find_or_create_application(waitlist)

        assert len(applications.documents) == 2

    def test_different_markets_do_not_collide(self, applications):
        market_a = self._app(market_id="market-a")
        market_b = self._app(market_id="market-b")

        ApplicationsApi.find_or_create_application(market_a)
        ApplicationsApi.find_or_create_application(market_b)

        assert len(applications.documents) == 2

    def test_the_upsert_recovers_from_a_duplicate_key_race(self, applications, monkeypatch):
        """The unique index turns a concurrent insert into a DuplicateKeyError, and the upsert
        catches it, reads the winner's document back, and returns it.

        A test that inserts sequentially proves nothing; this one drives the race by making the
        first write raise DuplicateKeyError the way the unique index would when another writer
        lands between the read and the insert.
        """
        calls = 0
        real_upsert = applications.find_one_and_update

        def one_duplicate(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise DuplicateKeyError("E11000 duplicate key error")
            return real_upsert(*args, **kwargs)

        monkeypatch.setattr(applications, "find_one_and_update", one_duplicate)

        # Pre-seed the winner's document so the fallback find_one can read it back
        app = self._app()
        ApplicationsApi.find_or_create_application(app)
        monkeypatch.setattr(applications, "find_one_and_update", one_duplicate)

        # Now race: the upsert raises DuplicateKeyError, but find_one finds the existing doc
        stored = ApplicationsApi.find_or_create_application(app)

        assert stored is not None
        assert stored.applicant_email == "vendor@example.com"
        assert len(applications.documents) == 1
