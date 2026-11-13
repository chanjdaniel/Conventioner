"""The real-MongoDB tests' fixtures: a server, a database of each test's own with every back-end
handle bound to it, the boot's indexes, a signed-in organizer, a market, and requests that meet.

The server is ``REAL_MONGODB_URI``. Unset, every test here skips, so the gate's run stays
hermetic; unset while ``REAL_MONGODB_REQUIRED`` is true, as CI's backend job sets it, every test
fails, so CI can never skip the suite in silence. A server that is not a loopback test server is
refused before any connection (``harness.server_refusal``).

The four suite-wide fakes of ``tests/conftest.py`` are named again here, so inside this package
pytest resolves ``applications``, ``market_records``, ``sign_in_attempts`` and
``organizer_sessions`` to the real collections and installs no fake; and since those four are used
by every test, every test here runs on its own bound database.
"""
import copy
import uuid
from types import SimpleNamespace

import pytest

from conftest import COMPLETE_PLAN, IMPORT_TIME_STAND_INS, STUBBED_MODULES, stored_market
from real_mongo import harness

#: The password every account ``signed_in`` makes is given; an account is a fixture address's.
FIXTURE_PASSWORD = "fixture-password-1"


@pytest.fixture(scope="session")
def real_mongo_client():
    """One client for the session, on the server the environment names, closed at its end."""
    if STUBBED_MODULES:
        pytest.skip("requires the real backend dependencies; running on stubs for "
                    + ", ".join(sorted(STUBBED_MODULES)))
    server = harness.the_server()
    if server.skip:
        pytest.skip(server.skip)
    if server.fail:
        pytest.fail(server.fail, pytrace=False)
    from pymongo import MongoClient

    client = MongoClient(server.uri)
    yield client
    client.close()


@pytest.fixture
def real_db(real_mongo_client, monkeypatch):
    """A database of this test's own, ``real_mongo_`` and 12 hex characters, every back-end handle
    bound to it, dropped at teardown whether the test passed or failed."""
    with harness.fresh_database(real_mongo_client) as db:
        harness.bind_handles(db, monkeypatch, IMPORT_TIME_STAND_INS)
        yield db


@pytest.fixture
def applications(real_db):
    """The real applications collection, in place of the suite-wide fake."""
    import api.applications as ApplicationsApi

    return ApplicationsApi.applications_collection


@pytest.fixture
def market_records(real_db):
    """The real collections of a market's other records, in place of the suite-wide fakes: the
    handles the modules hold, bound to this test's database."""
    import api.applicant_auth as ApplicantAuth
    import api.attendance as AttendanceApi
    import history as History
    import payments as Payments
    import remembered_sign_ins as RememberedSignIns
    import services.gridfs_service as GridfsService
    import vendor_notes as VendorNotes

    return SimpleNamespace(
        attendance=AttendanceApi.attendance_collection,
        challenges=ApplicantAuth.challenges_collection,
        remembered=RememberedSignIns.remembered_collection,
        history=History.history_collection, notes=VendorNotes.vendor_notes_collection,
        placement_history=History.legacy_placement_collection,
        payments=Payments.payments_collection, amounts_owed=Payments.amounts_owed_collection,
        images=GridfsService._fs,
    )


@pytest.fixture
def sign_in_attempts(real_db):
    """The real sign-in rate limit counters, in place of the suite-wide fake."""
    import sign_in_limits

    return sign_in_limits.attempts_collection


@pytest.fixture
def organizer_sessions(real_db):
    """The real organizers' sign-ins, in place of the suite-wide fake."""
    import organizer_sessions as OrganizerSessions

    return OrganizerSessions.sessions_collection


@pytest.fixture
def boot_indexes(real_db, monkeypatch):
    """Every index the boot builds, built on this test's database by the boot's own functions."""
    harness.build_boot_indexes(monkeypatch)
    return real_db


@pytest.fixture
def signed_in(real_db):
    """``signed_in(email)``: a Flask test client signed in through ``POST /login`` as a verified
    account ``create_account`` makes for ``email``. The client carries ``account_id`` and
    ``email``; the first account signed in owns what ``market_in`` makes."""
    import app as app_module
    import api.users as UsersApi
    from create_account import create_account

    accounts = []

    def sign_in(email: str):
        account_id = create_account(UsersApi.users_collection, email, FIXTURE_PASSWORD)
        client = app_module.app.test_client()
        response = client.post("/login", json={"email": email, "password": FIXTURE_PASSWORD})
        assert response.status_code == 200, response.get_json()
        client.account_id, client.email = account_id, email
        accounts.append(client)
        return client

    sign_in.accounts = accounts
    return sign_in


@pytest.fixture
def market_in(real_db, signed_in):
    """``market_in(phase, **overrides)``: a market stored in ``phase`` with ``COMPLETE_PLAN``, owned
    by the first account ``signed_in`` made, with a fresh id and name; returns the document."""
    from market_documents import MARKETS_COLLECTION

    def make(phase, **overrides):
        if not signed_in.accounts:
            raise AssertionError("market_in needs an organizer: call signed_in(email) first")
        fresh = uuid.uuid4().hex[:12]
        fields = {
            "id": str(uuid.uuid4()),
            "name": f"Test Market {fresh}",
            "roles": {signed_in.accounts[0].account_id: "owner"},
            "setupObject": copy.deepcopy(COMPLETE_PLAN),
        }
        fields.update(overrides)
        document = stored_market(phase, **fields)
        real_db[MARKETS_COLLECTION].insert_one(document)
        return document

    return make


@pytest.fixture
def interleave(monkeypatch):
    """``interleave(target, then)``: ``then()`` lands once, right after ``target``'s first call
    returns (``harness.interleave``)."""
    return lambda target, then: harness.interleave(monkeypatch, target, then)


@pytest.fixture
def race():
    """``race(n, fn)``: ``fn(i)`` on ``n`` threads released together (``harness.race``)."""
    return harness.race
