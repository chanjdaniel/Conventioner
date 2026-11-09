"""The organizer's sign-in is bounded like the applicant's (``sign_in_limits``).

Every try is counted per address and per caller before the account is looked up, so a refusal is
the same for an address with an account and without, and whether the password was right. A try
that signs in takes its count back, so an organizer who signs in all day is never held back and
only wrong tries pile up. A refusal answers 429 with a sentence that says the wait, under the key
the route's other answers use, and ``Retry-After``.
"""
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

from conftest import mongo_matches, mongo_project, skip_without_real_dependencies

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

skip_without_real_dependencies()

import app as app_module
import api.users as UsersApi
import sign_in_limits


ACCOUNT_EMAIL = "fixture-organizer@example.com"
UNVERIFIED_EMAIL = "fixture-unverified@example.com"
NO_ACCOUNT_EMAIL = "fixture-nobody@example.com"
PASSWORD = "fixture-password-1"
WRONG_PASSWORD = "not-the-password"
CALLER = "203.0.113.7"

# The start of a 15-minute window, so a refusal's wait is the whole window.
WINDOW_STARTS = datetime(2026, 11, 9, 12, 0, 0, tzinfo=timezone.utc)

DO_NOT_MATCH = "That email and password do not match."
VERIFY_FIRST = "Verify your email address first: we sent you a link when you registered."
TOO_MANY_SIGN_INS = "Too many sign-in attempts. Try again in 15 minutes, or reset your password."


class Users:
    """A users collection read and written the way Mongo does, recording every read."""

    def __init__(self, *docs):
        self.docs = [dict(doc) for doc in docs]
        self.reads = []

    def find_one(self, query, projection=None):
        self.reads.append(query)
        for doc in self.docs:
            if mongo_matches(doc, query):
                return mongo_project(dict(doc), projection)
        return None

    def update_one(self, query, update):
        for doc in self.docs:
            if mongo_matches(doc, query):
                doc.update(update.get("$set", {}))
                return


# Hashed at bcrypt's lowest cost, so the many tries here check quickly; the cost is not what is
# under test (``test_the_sign_in_answers.py`` holds the stand-in hash to the app's).
FAST_ROUNDS = 4
_hashes = {}


def _hash(password):
    if password not in _hashes:
        _hashes[password] = app_module.bcrypt.generate_password_hash(
            password, rounds=FAST_ROUNDS).decode("utf-8")
    return _hashes[password]


@pytest.fixture(autouse=True)
def fast_stand_in_hash(monkeypatch):
    monkeypatch.setattr(UsersApi, "_no_account_hash", _hash("fixture-stand-in"))


def _account(email, verified=True, password=PASSWORD):
    return {
        "id": f"id-{email}",
        "email": email,
        "password": _hash(password),
        "organizations": [],
        "email_verified": verified,
        "login_id": f"login-{email}",
    }


@pytest.fixture
def users(monkeypatch):
    fake = Users(_account(ACCOUNT_EMAIL), _account(UNVERIFIED_EMAIL, verified=False))
    monkeypatch.setattr(UsersApi, "users_collection", fake)
    return fake


@pytest.fixture
def clock(monkeypatch):
    """The server's clock, held at the start of a window until a test moves it."""
    now = {"at": WINDOW_STARTS}
    monkeypatch.setattr(UsersApi, "_now", lambda: now["at"].timestamp())
    return now


@pytest.fixture
def client():
    return app_module.app.test_client()


@pytest.fixture
def password_checks(monkeypatch):
    """Every bcrypt check the sign-in makes, by the hash it checked against."""
    checked = []
    check = app_module.bcrypt.check_password_hash

    def spy(pw_hash, password):
        checked.append(pw_hash)
        return check(pw_hash, password)

    monkeypatch.setattr(app_module.bcrypt, "check_password_hash", spy)
    return checked


def _sign_in(client, email, password, caller=CALLER):
    return client.post(
        "/login", json={"email": email, "password": password},
        environ_base={"REMOTE_ADDR": caller},
    )


def _answer(response):
    return response.status_code, response.get_json(), response.headers.get("Retry-After")


REFUSED = (429, {"message": TOO_MANY_SIGN_INS}, "900")


class TestThePasswordSignInIsBounded:
    def test_past_ten_tries_at_an_address_the_sign_in_waits_alike_for_every_address(
        self, client, users, clock,
    ):
        for email, caller in ((ACCOUNT_EMAIL, "198.51.100.1"), (NO_ACCOUNT_EMAIL, "198.51.100.2")):
            tries = [_sign_in(client, email, WRONG_PASSWORD, caller).status_code
                     for _ in range(sign_in_limits.PASSWORD_PER_ADDRESS.attempts)]
            assert set(tries) == {401}

        refusals = [
            _answer(_sign_in(client, ACCOUNT_EMAIL, PASSWORD, "198.51.100.1")),
            _answer(_sign_in(client, ACCOUNT_EMAIL, WRONG_PASSWORD, "198.51.100.3")),
            _answer(_sign_in(client, NO_ACCOUNT_EMAIL, PASSWORD, "198.51.100.2")),
            _answer(_sign_in(client, NO_ACCOUNT_EMAIL, WRONG_PASSWORD, "198.51.100.4")),
        ]

        assert refusals == [REFUSED] * 4

    def test_the_address_is_counted_as_typed_or_not(self, client, users, clock):
        for _ in range(sign_in_limits.PASSWORD_PER_ADDRESS.attempts):
            _sign_in(client, ACCOUNT_EMAIL.upper(), WRONG_PASSWORD)

        assert _answer(_sign_in(client, f" {ACCOUNT_EMAIL} ", PASSWORD)) == REFUSED

    def test_past_fifty_tries_from_a_caller_every_address_waits_alike(self, client, users, clock):
        # Five tries at each of ten addresses: every address within its own limit.
        statuses = [_sign_in(client, f"fixture-guess-{n % 10}@example.com", WRONG_PASSWORD)
                    .status_code for n in range(sign_in_limits.PASSWORD_PER_CALLER.attempts)]
        assert set(statuses) == {401}

        assert _answer(_sign_in(client, NO_ACCOUNT_EMAIL, WRONG_PASSWORD)) == REFUSED
        assert _answer(_sign_in(client, ACCOUNT_EMAIL, PASSWORD)) == REFUSED
        # Another caller is not held back by this one's tries.
        assert _sign_in(client, ACCOUNT_EMAIL, PASSWORD, "198.51.100.9").status_code == 200

    def test_a_request_with_no_address_still_counts_against_its_caller(
        self, client, users, clock,
    ):
        for _ in range(sign_in_limits.PASSWORD_PER_CALLER.attempts):
            assert client.post("/login", json={},
                               environ_base={"REMOTE_ADDR": CALLER}).status_code == 400

        assert _answer(_sign_in(client, ACCOUNT_EMAIL, PASSWORD)) == REFUSED

    def test_a_refused_sign_in_reads_no_account_and_checks_no_password(
        self, client, users, clock, password_checks,
    ):
        for _ in range(sign_in_limits.PASSWORD_PER_ADDRESS.attempts):
            _sign_in(client, ACCOUNT_EMAIL, WRONG_PASSWORD)
        users.reads.clear()
        password_checks.clear()

        assert _answer(_sign_in(client, ACCOUNT_EMAIL, PASSWORD)) == REFUSED
        assert users.reads == []
        assert password_checks == []

    def test_the_next_window_starts_from_nothing(self, client, users, clock):
        for _ in range(sign_in_limits.PASSWORD_PER_ADDRESS.attempts + 1):
            _sign_in(client, ACCOUNT_EMAIL, WRONG_PASSWORD)

        clock["at"] = WINDOW_STARTS + timedelta(minutes=15)

        assert _sign_in(client, ACCOUNT_EMAIL, PASSWORD).status_code == 200

    def test_the_wait_is_what_is_left_of_the_window(self, client, users, clock):
        for _ in range(sign_in_limits.PASSWORD_PER_ADDRESS.attempts):
            _sign_in(client, ACCOUNT_EMAIL, WRONG_PASSWORD)

        clock["at"] = WINDOW_STARTS + timedelta(minutes=14, seconds=1)

        assert _answer(_sign_in(client, ACCOUNT_EMAIL, PASSWORD)) == (
            429,
            {"message": "Too many sign-in attempts. Try again in 1 minute, or reset your password."},
            "59",
        )


class TestARightPasswordTakesItsTryBack:
    def test_twenty_right_sign_ins_from_one_caller_all_sign_in(self, client, users, clock):
        statuses = [_sign_in(client, ACCOUNT_EMAIL, PASSWORD).status_code for _ in range(20)]

        assert set(statuses) == {200}

    def test_a_right_password_takes_back_only_its_own_try(self, client, users, clock):
        wrong = [_sign_in(client, ACCOUNT_EMAIL, WRONG_PASSWORD).status_code for _ in range(9)]
        right = _sign_in(client, ACCOUNT_EMAIL, PASSWORD).status_code
        tenth_wrong = _sign_in(client, ACCOUNT_EMAIL, WRONG_PASSWORD).status_code

        assert (set(wrong), right, tenth_wrong) == ({401}, 200, 401)
        assert _answer(_sign_in(client, ACCOUNT_EMAIL, PASSWORD)) == REFUSED

    def test_a_right_password_on_an_unverified_account_takes_its_try_back(
        self, client, users, clock,
    ):
        answers = {_sign_in(client, UNVERIFIED_EMAIL, PASSWORD).get_json()["message"]
                   for _ in range(20)}

        assert answers == {VERIFY_FIRST}

    def test_a_right_password_takes_back_the_callers_try_too(self, client, users, clock):
        organizers = [f"fixture-organizer-{n}@example.com" for n in range(60)]
        users.docs.extend(_account(email) for email in organizers)

        statuses = [_sign_in(client, email, PASSWORD).status_code for email in organizers]

        assert set(statuses) == {200}


class TestAPasswordLongerThanBcryptReads:
    """bcrypt reads at most 72 bytes of a password; a longer one is one that does not match."""

    @pytest.mark.parametrize("password", ["p" * 73, "é" * 37], ids=["73 ASCII", "37 accented"])
    @pytest.mark.parametrize("email", [ACCOUNT_EMAIL, NO_ACCOUNT_EMAIL])
    def test_it_answers_as_a_password_that_does_not_match_and_is_never_checked(
        self, client, users, clock, password_checks, email, password,
    ):
        assert len(password.encode("utf-8")) > 72

        response = _sign_in(client, email, password)

        assert (response.status_code, response.get_json()) == (401, {"message": DO_NOT_MATCH})
        assert password_checks == []

    def test_a_password_of_72_bytes_signs_in(self, client, users, clock):
        password = "p" * 72
        users.docs.append(_account("fixture-long@example.com", password=password))

        assert _sign_in(client, "fixture-long@example.com", password).status_code == 200
