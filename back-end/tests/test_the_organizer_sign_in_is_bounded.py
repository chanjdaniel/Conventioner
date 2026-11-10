"""The organizer's sign-in is bounded like the applicant's (``sign_in_limits``).

Every try is counted per address and per caller before the account is looked up, so a refusal is
the same for an address with an account and without, and whether the password was right. A try
that signs in takes its count back, so an organizer who signs in all day is never held back and
only wrong tries pile up. A refusal answers 429 with a sentence that says the wait, under the key
the route's other answers use, and ``Retry-After``.
"""
import os
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

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
    """A users collection read and written the way Mongo does, recording every read.

    A conditional update is applied whole under a lock, as Mongo applies one to a document, and a
    plain read can be made slow (``slow_reads``), so tries arriving at once are held to a code's
    five only by a count made in that one update.
    """

    def __init__(self, *docs):
        self.docs = [dict(doc) for doc in docs]
        self.reads = []
        self.slow_reads = False
        self.most_code_tries = 0
        self._lock = threading.Lock()

    def find_one(self, query, projection=None):
        self.reads.append(query)
        if self.slow_reads:
            time.sleep(0.05)
        for doc in self.docs:
            if mongo_matches(doc, query):
                return mongo_project(dict(doc), projection)
        return None

    def find_one_and_update(self, query, update, return_document=None):
        self.reads.append(query)
        with self._lock:
            for doc in self.docs:
                if mongo_matches(doc, query):
                    self._apply(doc, update)
                    return dict(doc)
        return None

    def update_one(self, query, update):
        with self._lock:
            for doc in self.docs:
                if mongo_matches(doc, query):
                    self._apply(doc, update)
                    return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)

    def _apply(self, doc, update):
        doc.update(update.get("$set", {}))
        for field, amount in update.get("$inc", {}).items():
            doc[field] = doc.get(field, 0) + amount
        self.most_code_tries = max(self.most_code_tries, doc.get("otp_attempts") or 0)

    def account(self, email):
        return next(doc for doc in self.docs if doc["email"] == email)


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

    def test_a_sign_in_is_not_counted_against_the_caller(self, client, users, clock):
        organizers = [f"fixture-organizer-{n}@example.com" for n in range(60)]
        users.docs.extend(_account(email) for email in organizers)

        statuses = [_sign_in(client, email, PASSWORD).status_code for email in organizers]

        assert set(statuses) == {200}

    def test_a_sign_in_gives_the_caller_no_more_wrong_tries(self, client, users, clock):
        # Rounds of 49 wrong passwords over five addresses with no account, each within its own
        # ten, then a right password for an account of the caller's own: the caller's fifty count
        # every wrong try, whatever right ones come between them.
        guesses = [f"fixture-guess-{n}@example.com" for n in range(15)]
        rounds = []
        for round_ in range(3):
            wrong = [_answer(_sign_in(client, guesses[round_ * 5 + n % 5], WRONG_PASSWORD))
                     for n in range(sign_in_limits.PASSWORD_PER_CALLER.attempts - 1)]
            _sign_in(client, UNVERIFIED_EMAIL, PASSWORD)
            rounds.append(wrong)

        assert {status for status, _, _ in rounds[0]} == {401}
        # The fiftieth wrong try is the last one let through.
        assert rounds[1][0] == (401, {"message": DO_NOT_MATCH}, None)
        assert rounds[1][1:] == [REFUSED] * (sign_in_limits.PASSWORD_PER_CALLER.attempts - 2)
        assert rounds[2] == [REFUSED] * (sign_in_limits.PASSWORD_PER_CALLER.attempts - 1)


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


# The code sign-in.

CODE = "123456"
WRONG_CODE = "000000"
WRONG_CODE_SAYS = "That code is not right."
# A code is issued at the start of the window, lasting five minutes; the next may be asked for an
# hour after it expires.
CODE_EXPIRES = WINDOW_STARTS + timedelta(minutes=5)
NEXT_CODE_AT = CODE_EXPIRES + timedelta(hours=1)

CODE_REFUSED = (429, {"msg": TOO_MANY_SIGN_INS}, "900")


def _issue_code(users, email, code=CODE):
    users.account(email).update(
        {"otp": code, "otp_expires": CODE_EXPIRES.isoformat(), "otp_attempts": 0})


@pytest.fixture
def coded(users):
    """The verified and the unverified account, each holding a live code."""
    _issue_code(users, ACCOUNT_EMAIL)
    _issue_code(users, UNVERIFIED_EMAIL)
    return users


def _enter_code(client, email, code, caller=CALLER):
    return client.post(
        "/login-otp", json={"email": email, "otp": code}, environ_base={"REMOTE_ADDR": caller},
    )


@pytest.fixture
def code_comparisons(monkeypatch):
    """Every comparison of a code, as ``api.users`` reaches ``secrets.compare_digest``."""
    compared = []
    real = UsersApi.secrets

    def spy(a, b):
        compared.append((a, b))
        return real.compare_digest(a, b)

    class Secrets:
        compare_digest = staticmethod(spy)

        def __getattr__(self, name):
            return getattr(real, name)

    monkeypatch.setattr(UsersApi, "secrets", Secrets())
    return compared


class TestTheCodeSignInIsBounded:
    def test_past_ten_tries_at_an_address_the_code_sign_in_waits_alike_for_every_address(
        self, client, coded, clock,
    ):
        for email, caller in ((ACCOUNT_EMAIL, "198.51.100.1"), (NO_ACCOUNT_EMAIL, "198.51.100.2")):
            for _ in range(sign_in_limits.ORGANIZER_CODE_PER_ADDRESS.attempts):
                _enter_code(client, email, WRONG_CODE, caller)
        _issue_code(coded, ACCOUNT_EMAIL)

        refusals = [
            _answer(_enter_code(client, ACCOUNT_EMAIL, CODE, "198.51.100.1")),
            _answer(_enter_code(client, ACCOUNT_EMAIL, WRONG_CODE, "198.51.100.3")),
            _answer(_enter_code(client, NO_ACCOUNT_EMAIL, CODE, "198.51.100.2")),
            _answer(_enter_code(client, NO_ACCOUNT_EMAIL, WRONG_CODE, "198.51.100.4")),
        ]

        assert refusals == [CODE_REFUSED] * 4

    def test_past_sixty_tries_from_a_caller_every_address_waits_alike(self, client, coded, clock):
        # Six tries at each of ten addresses with no account: every address within its own limit.
        statuses = [_enter_code(client, f"fixture-guess-{n % 10}@example.com", WRONG_CODE)
                    .status_code for n in range(sign_in_limits.ORGANIZER_CODE_PER_CALLER.attempts)]
        assert set(statuses) == {401}

        assert _answer(_enter_code(client, NO_ACCOUNT_EMAIL, WRONG_CODE)) == CODE_REFUSED
        assert _answer(_enter_code(client, ACCOUNT_EMAIL, CODE)) == CODE_REFUSED
        # Another caller is not held back by this one's tries.
        assert _enter_code(client, ACCOUNT_EMAIL, CODE, "198.51.100.9").status_code == 200

    def test_a_request_with_no_code_still_counts_against_its_caller(self, client, coded, clock):
        for _ in range(sign_in_limits.ORGANIZER_CODE_PER_CALLER.attempts):
            assert client.post("/login-otp", json={"email": ACCOUNT_EMAIL},
                               environ_base={"REMOTE_ADDR": CALLER}).status_code == 400

        assert _answer(_enter_code(client, ACCOUNT_EMAIL, CODE)) == CODE_REFUSED

    def test_a_refused_code_reads_no_account_and_compares_no_code(
        self, client, coded, clock, code_comparisons,
    ):
        for _ in range(sign_in_limits.ORGANIZER_CODE_PER_ADDRESS.attempts):
            _enter_code(client, NO_ACCOUNT_EMAIL, WRONG_CODE)
        coded.reads.clear()

        assert _answer(_enter_code(client, NO_ACCOUNT_EMAIL, CODE)) == CODE_REFUSED
        assert coded.reads == []
        assert code_comparisons == []

    def test_the_next_window_starts_from_nothing(self, client, coded, clock):
        for _ in range(sign_in_limits.ORGANIZER_CODE_PER_ADDRESS.attempts + 1):
            _enter_code(client, NO_ACCOUNT_EMAIL, WRONG_CODE)

        clock["at"] = WINDOW_STARTS + timedelta(minutes=15)

        assert _enter_code(client, NO_ACCOUNT_EMAIL, WRONG_CODE).status_code == 401


class TestARightCodeTakesItsTryBack:
    def test_twenty_right_codes_from_one_caller_all_sign_in(self, client, coded, clock):
        statuses = []
        for _ in range(20):
            _issue_code(coded, ACCOUNT_EMAIL)
            statuses.append(_enter_code(client, ACCOUNT_EMAIL, CODE).status_code)

        assert set(statuses) == {200}

    def test_a_right_code_takes_back_only_its_own_try(self, client, coded, clock):
        # The fifth wrong code discards the code, so a new one is issued for the right try.
        wrong = [_enter_code(client, ACCOUNT_EMAIL, WRONG_CODE).status_code for _ in range(9)]
        _issue_code(coded, ACCOUNT_EMAIL)
        right = _enter_code(client, ACCOUNT_EMAIL, CODE).status_code
        tenth_wrong = _enter_code(client, ACCOUNT_EMAIL, WRONG_CODE).status_code

        assert (set(wrong), right, tenth_wrong) == ({401}, 200, 401)
        _issue_code(coded, ACCOUNT_EMAIL)
        assert _answer(_enter_code(client, ACCOUNT_EMAIL, CODE)) == CODE_REFUSED

    def test_a_right_code_on_an_unverified_account_takes_its_try_back(self, client, coded, clock):
        wrong = [_enter_code(client, UNVERIFIED_EMAIL, WRONG_CODE).status_code for _ in range(9)]
        _issue_code(coded, UNVERIFIED_EMAIL)
        right = _answer(_enter_code(client, UNVERIFIED_EMAIL, CODE))
        tenth_wrong = _enter_code(client, UNVERIFIED_EMAIL, WRONG_CODE).status_code

        assert (set(wrong), right, tenth_wrong) == (
            {401}, (403, {"msg": VERIFY_FIRST}, None), 401)
        assert _answer(_enter_code(client, UNVERIFIED_EMAIL, CODE)) == CODE_REFUSED

    def test_a_sign_in_is_not_counted_against_the_caller(self, client, users, clock):
        organizers = [f"fixture-organizer-{n}@example.com" for n in range(70)]
        users.docs.extend(_account(email) for email in organizers)
        for email in organizers:
            _issue_code(users, email)

        statuses = [_enter_code(client, email, CODE).status_code for email in organizers]

        assert set(statuses) == {200}

    def test_a_sign_in_gives_the_caller_no_more_wrong_tries(self, client, coded, clock):
        # Rounds of 59 wrong codes over six addresses with no account, each within its own ten,
        # then a right code for an account of the caller's own: the caller's sixty count every
        # wrong try, whatever right ones come between them.
        guesses = [f"fixture-guess-{n}@example.com" for n in range(18)]
        rounds = []
        for round_ in range(3):
            wrong = [_answer(_enter_code(client, guesses[round_ * 6 + n % 6], WRONG_CODE))
                     for n in range(sign_in_limits.ORGANIZER_CODE_PER_CALLER.attempts - 1)]
            _issue_code(coded, UNVERIFIED_EMAIL)
            _enter_code(client, UNVERIFIED_EMAIL, CODE)
            rounds.append(wrong)

        assert {status for status, _, _ in rounds[0]} == {401}
        # The sixtieth wrong try is the last one let through.
        assert rounds[1][0] == (401, {"msg": WRONG_CODE_SAYS}, None)
        assert rounds[1][1:] == [CODE_REFUSED] * (sign_in_limits.ORGANIZER_CODE_PER_CALLER.attempts - 2)
        assert rounds[2] == [CODE_REFUSED] * (sign_in_limits.ORGANIZER_CODE_PER_CALLER.attempts - 1)


class TestACodesTriesAreCountedInOneUpdate:
    """No more than five tries ever reach one code, even when they arrive at once."""

    def test_ten_wrong_codes_at_once_reach_the_code_at_most_five_times(
        self, coded, clock, code_comparisons,
    ):
        coded.slow_reads = True
        start = threading.Barrier(10)
        answers = []

        def enter(n):
            client = app_module.app.test_client()
            start.wait()
            answers.append(_enter_code(client, ACCOUNT_EMAIL, f"00000{n}", f"198.51.100.{n}")
                           .status_code)

        threads = [threading.Thread(target=enter, args=(n,)) for n in range(10)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        assert len(code_comparisons) <= 5
        assert coded.most_code_tries <= 5
        assert answers == [401] * 10
        assert coded.account(ACCOUNT_EMAIL)["otp"] is None

    def test_the_fifth_wrong_code_answers_as_the_others_and_discards_the_code_in_silence(
        self, client, coded, clock,
    ):
        answers = [_answer(_enter_code(client, ACCOUNT_EMAIL, WRONG_CODE)) for _ in range(5)]

        assert answers == [(401, {"msg": WRONG_CODE_SAYS}, None)] * 5
        account = coded.account(ACCOUNT_EMAIL)
        assert (account["otp"], account["otp_attempts"]) == (None, 0)
        assert account["otp_expires"] == CODE_EXPIRES.isoformat()

        asked = client.post("/request-otp", json={"email": ACCOUNT_EMAIL},
                            environ_base={"REMOTE_ADDR": CALLER})
        assert (asked.status_code, asked.get_json()) == (
            429, {"msg": "You can ask for a new code in 65 minutes."})

    def test_a_right_code_after_the_fifth_wrong_one_does_not_sign_in(self, client, coded, clock):
        for _ in range(5):
            _enter_code(client, ACCOUNT_EMAIL, WRONG_CODE)

        assert _answer(_enter_code(client, ACCOUNT_EMAIL, CODE)) == (
            401, {"msg": WRONG_CODE_SAYS}, None)

    def test_of_two_right_tries_in_turn_only_the_first_signs_in(self, client, coded, clock):
        first = _enter_code(client, ACCOUNT_EMAIL, CODE).status_code
        second = _answer(_enter_code(client, ACCOUNT_EMAIL, CODE))

        assert (first, second) == (200, (401, {"msg": WRONG_CODE_SAYS}, None))

    def test_a_right_code_another_try_consumed_first_does_not_sign_in(
        self, monkeypatch, client, coded, clock,
    ):
        # Another right try consumes the code between this one's count and its own consuming.
        consume = coded.update_one

        def consumed_first(query, update):
            coded.account(ACCOUNT_EMAIL).update({"otp": None, "otp_expires": None})
            return consume(query, update)

        monkeypatch.setattr(coded, "update_one", consumed_first)

        assert _answer(_enter_code(client, ACCOUNT_EMAIL, CODE)) == (
            401, {"msg": WRONG_CODE_SAYS}, None)

    def test_an_expired_right_code_says_when_a_new_one_may_be_asked_for(
        self, client, coded, clock,
    ):
        clock["at"] = CODE_EXPIRES + timedelta(minutes=5)

        assert _answer(_enter_code(client, ACCOUNT_EMAIL, CODE)) == (
            400, {"msg": "That code has expired. You can ask for a new code in 55 minutes."}, None)

        clock["at"] = NEXT_CODE_AT

        assert _answer(_enter_code(client, ACCOUNT_EMAIL, CODE)) == (
            400, {"msg": "That code has expired. Ask for a new one."}, None)

    def test_asking_too_soon_for_another_code_says_the_wait(self, client, coded, clock):
        clock["at"] = NEXT_CODE_AT - timedelta(seconds=30)

        asked = client.post("/request-otp", json={"email": ACCOUNT_EMAIL},
                            environ_base={"REMOTE_ADDR": CALLER})

        assert (asked.status_code, asked.get_json()) == (
            429, {"msg": "You can ask for a new code in 1 minute."})


# The requests that send a mail: a code, a reset link, a verification link, and the sign-up.

ASKED_TOO_OFTEN = "You have asked several times. Try again in 15 minutes."
ASKED_REFUSED = (429, {"msg": ASKED_TOO_OFTEN}, "900")


class MailRequest:
    """One request that sends a mail, its limits, and an address it would send to if let through."""

    def __init__(self, path, per_address, per_caller, sends_to, extra=None):
        self.path = path
        self.per_address = per_address
        self.per_caller = per_caller
        self.sends_to = sends_to
        self.extra = extra or {}

    def __repr__(self):
        return self.path

    def ask(self, client, email, caller=CALLER):
        return client.post(self.path, json={"email": email, **self.extra},
                           environ_base={"REMOTE_ADDR": caller})


MAIL_REQUESTS = [
    MailRequest("/request-otp", sign_in_limits.ORGANIZER_CODE_REQUEST_PER_ADDRESS,
                sign_in_limits.ORGANIZER_CODE_REQUEST_PER_CALLER, ACCOUNT_EMAIL),
    MailRequest("/request-password-reset", sign_in_limits.RESET_LINK_PER_ADDRESS,
                sign_in_limits.RESET_LINK_PER_CALLER, ACCOUNT_EMAIL),
    MailRequest("/resend-verification", sign_in_limits.VERIFICATION_LINK_PER_ADDRESS,
                sign_in_limits.VERIFICATION_LINK_PER_CALLER, UNVERIFIED_EMAIL),
    MailRequest("/register", sign_in_limits.SIGN_UP_PER_ADDRESS, sign_in_limits.SIGN_UP_PER_CALLER,
                NO_ACCOUNT_EMAIL, {"password": PASSWORD, "captcha_token": "fixture-captcha"}),
]


class MailingUsers(Users):
    """The users collection, which a sign-up also inserts into."""

    def insert_one(self, doc):
        with self._lock:
            self.docs.append(dict(doc))
        return SimpleNamespace(inserted_id=doc["id"])

    def delete_one(self, query):
        self.docs = [doc for doc in self.docs if not mongo_matches(doc, query)]


@pytest.fixture
def mailing_users(monkeypatch):
    fake = MailingUsers(_account(ACCOUNT_EMAIL), _account(UNVERIFIED_EMAIL, verified=False))
    monkeypatch.setattr(UsersApi, "users_collection", fake)
    return fake


@pytest.fixture
def outbox(monkeypatch):
    """Every mail sent, by the address it went to."""
    sent = []

    def sender(to, *_secret):
        sent.append(to)
        return True

    for name in ("send_otp_email", "send_password_reset_email", "send_verification_email",
                 "send_account_exists_email"):
        monkeypatch.setattr(UsersApi, name, sender)
    return sent


@pytest.fixture
def captcha_checks(monkeypatch):
    """Every captcha check a sign-up makes; each passes."""
    checked = []

    def check(token, _ip_address=None):
        checked.append(token)
        return True, 0.9

    monkeypatch.setattr(UsersApi, "verify_recaptcha", check)
    return checked


@pytest.fixture
def mail(mailing_users, outbox, captcha_checks, clock, monkeypatch):
    # A sign-up hashes at bcrypt's lowest cost, as the accounts here are hashed.
    monkeypatch.setattr(app_module.bcrypt, "_log_rounds", FAST_ROUNDS)
    return SimpleNamespace(users=mailing_users, outbox=outbox, captcha_checks=captcha_checks)


@pytest.mark.parametrize("asked", MAIL_REQUESTS, ids=repr)
class TestTheMailRequestsAreBounded:
    def test_past_five_at_an_address_the_next_waits_alike_for_every_address(
        self, client, mail, asked,
    ):
        addresses = ((ACCOUNT_EMAIL, "198.51.100.1"), (UNVERIFIED_EMAIL, "198.51.100.2"),
                     (NO_ACCOUNT_EMAIL, "198.51.100.3"))
        for email, caller in addresses:
            answers = [_answer(asked.ask(client, email, caller))
                       for _ in range(asked.per_address.attempts)]
            assert ASKED_REFUSED not in answers

        refusals = [_answer(asked.ask(client, email, caller)) for email, caller in addresses]
        # Another caller asking for the same address is held back too.
        refusals.append(_answer(asked.ask(client, ACCOUNT_EMAIL, "198.51.100.4")))

        assert refusals == [ASKED_REFUSED] * 4

    def test_past_thirty_from_a_caller_every_address_waits_alike(self, client, mail, asked):
        # Three requests for each of ten addresses: every address within its own limit.
        answers = [_answer(asked.ask(client, f"fixture-guess-{n % 10}@example.com"))
                   for n in range(asked.per_caller.attempts)]
        assert ASKED_REFUSED not in answers

        assert _answer(asked.ask(client, NO_ACCOUNT_EMAIL)) == ASKED_REFUSED
        assert _answer(asked.ask(client, ACCOUNT_EMAIL)) == ASKED_REFUSED
        # Another caller is not held back by this one's requests.
        assert _answer(asked.ask(client, ACCOUNT_EMAIL, "198.51.100.9")) != ASKED_REFUSED

    def test_a_request_refused_at_its_address_reads_no_account_and_sends_nothing(
        self, client, mail, asked,
    ):
        for n in range(asked.per_address.attempts):
            asked.ask(client, asked.sends_to, f"198.51.100.{n}")
        mail.users.reads.clear()
        mail.outbox.clear()
        mail.captcha_checks.clear()

        assert _answer(asked.ask(client, asked.sends_to)) == ASKED_REFUSED
        assert (mail.users.reads, mail.outbox, mail.captcha_checks) == ([], [], [])

    def test_a_request_refused_at_its_caller_reads_no_account_and_sends_nothing(
        self, client, mail, asked,
    ):
        for n in range(asked.per_caller.attempts):
            asked.ask(client, f"fixture-guess-{n % 10}@example.com")
        mail.users.reads.clear()
        mail.outbox.clear()
        mail.captcha_checks.clear()

        assert _answer(asked.ask(client, asked.sends_to)) == ASKED_REFUSED
        assert (mail.users.reads, mail.outbox, mail.captcha_checks) == ([], [], [])

    def test_below_the_limits_the_request_sends_its_mail(self, client, mail, asked):
        assert asked.ask(client, asked.sends_to).status_code in (200, 201)
        assert mail.outbox == [asked.sends_to]

    def test_a_request_with_no_address_still_counts_against_its_caller(self, client, mail, asked):
        for _ in range(asked.per_caller.attempts):
            assert client.post(asked.path, json={},
                               environ_base={"REMOTE_ADDR": CALLER}).status_code == 400

        assert _answer(asked.ask(client, asked.sends_to)) == ASKED_REFUSED

    def test_the_next_window_starts_from_nothing(self, client, mail, clock, asked):
        for _ in range(asked.per_address.attempts + 1):
            asked.ask(client, NO_ACCOUNT_EMAIL, "198.51.100.1")

        clock["at"] = WINDOW_STARTS + timedelta(minutes=15)

        assert _answer(asked.ask(client, NO_ACCOUNT_EMAIL, "198.51.100.1")) != ASKED_REFUSED

    def test_one_requests_use_holds_back_no_other(self, client, mail, asked):
        for n in range(asked.per_caller.attempts + 1):
            asked.ask(client, f"fixture-guess-{n % 10}@example.com")
        for _ in range(asked.per_address.attempts + 1):
            asked.ask(client, ACCOUNT_EMAIL, "198.51.100.1")
        assert _answer(asked.ask(client, ACCOUNT_EMAIL)) == ASKED_REFUSED

        others = [_answer(other.ask(client, ACCOUNT_EMAIL))
                  for other in MAIL_REQUESTS if other is not asked]

        assert ASKED_REFUSED not in others


# A password longer than bcrypt reads, at sign-up and at a reset.
TOO_LONG = ("That password is too long. Use 72 characters or fewer; an accented letter or an emoji "
            "counts as more than one.")
TOO_SHORT = "Password must be at least 8 characters long"
LONG_PASSWORDS = pytest.mark.parametrize(
    "password", ["p" * 73, "é" * 37], ids=["73 ASCII", "37 accented"])
PASSWORDS_OF_72_BYTES = pytest.mark.parametrize(
    "password", ["p" * 72, "é" * 36], ids=["72 ASCII", "36 accented"])
SIGN_UP_EMAIL = "fixture-new@example.com"
RESET_TOKEN = "fixture-reset-token"


@pytest.fixture
def hashes_made(monkeypatch):
    """Every password the app hashes."""
    hashed = []
    generate = app_module.bcrypt.generate_password_hash

    def spy(password, rounds=None):
        hashed.append(password)
        return generate(password, rounds=FAST_ROUNDS)

    monkeypatch.setattr(app_module.bcrypt, "generate_password_hash", spy)
    return hashed


@pytest.fixture
def resettable(mail):
    """The account, with a reset link sent an hour from expiring."""
    account = mail.users.account(ACCOUNT_EMAIL)
    account["password_reset_token"] = RESET_TOKEN
    account["password_reset_token_expires"] = (
        datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    return account


def _sign_up(client, password):
    return client.post("/register", json={
        "email": SIGN_UP_EMAIL, "password": password, "captcha_token": "fixture-captcha"})


def _reset(client, password):
    return client.post("/reset-password", json={"token": RESET_TOKEN, "new_password": password})


class TestAPasswordLongerThanBcryptReadsIsRefused:
    """A sign-up or a reset with a password longer than 72 UTF-8 bytes says so, and stores nothing."""

    @LONG_PASSWORDS
    def test_a_sign_up_says_the_password_is_too_long_and_stores_nothing(
        self, client, mail, hashes_made, password,
    ):
        assert len(password.encode("utf-8")) > 72
        accounts_before = [dict(doc) for doc in mail.users.docs]

        response = _sign_up(client, password)

        assert (response.status_code, response.get_json()) == (400, {"msg": TOO_LONG})
        assert mail.users.docs == accounts_before
        assert (hashes_made, mail.outbox) == ([], [])

    @LONG_PASSWORDS
    def test_a_reset_says_the_password_is_too_long_and_stores_nothing(
        self, client, resettable, hashes_made, password,
    ):
        account_before = dict(resettable)

        response = _reset(client, password)

        assert (response.status_code, response.get_json()) == (400, {"msg": TOO_LONG})
        assert resettable == account_before
        assert hashes_made == []

    @PASSWORDS_OF_72_BYTES
    def test_a_password_of_72_bytes_signs_up(self, client, mail, clock, password):
        assert _sign_up(client, password).status_code == 201

        mail.users.account(SIGN_UP_EMAIL)["email_verified"] = True
        assert _sign_in(client, SIGN_UP_EMAIL, password).status_code == 200

    @PASSWORDS_OF_72_BYTES
    def test_a_password_of_72_bytes_resets(self, client, resettable, clock, password):
        assert _reset(client, password).status_code == 200

        assert resettable["password_reset_token"] is None
        assert _sign_in(client, ACCOUNT_EMAIL, password).status_code == 200

    @pytest.mark.parametrize("ask", [_sign_up, _reset], ids=["sign-up", "reset"])
    def test_a_short_password_is_still_refused_as_too_short(self, client, resettable, ask):
        response = ask(client, "short")

        assert (response.status_code, response.get_json()) == (400, {"msg": TOO_SHORT})
