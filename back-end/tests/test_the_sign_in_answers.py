"""What the organizer's sign-in answers when it does not sign in (E38/F14/S02).

Each answer says what happened and what to do next, in the screen's own words, and says "sign in",
never "log in":

- A wrong password and an address with no account answer alike, so the answer never tells one
  from the other; the sign-in screen puts "Forgot password?" beside it.
- A right password on an account not yet verified answers that the address needs verifying first;
  the screen offers to send the link again. The code sign-in and asking for a code answer the same.
- A code for an address with no account answers as a wrong code does.
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


FIXTURE_EMAIL = "fixture-user@example.com"
NO_ACCOUNT_EMAIL = "fixture-nobody@example.com"
FIXTURE_PASSWORD = "fixture-password-1"
FIXTURE_OTP = "123456"

DO_NOT_MATCH = "That email and password do not match."
VERIFY_FIRST = "Verify your email address first: we sent you a link when you registered."
WRONG_CODE = "That code is not right."


class Accounts:
    """A users collection holding at most one account, read and written the way Mongo does."""

    def __init__(self, doc):
        self.doc = dict(doc)

    def find_one(self, query, projection=None):
        if mongo_matches(self.doc, query):
            return mongo_project(dict(self.doc), projection)
        return None

    def update_one(self, query, update):
        if mongo_matches(self.doc, query):
            self.doc.update(update["$set"])


def _account(verified: bool):
    in_an_hour = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    return {
        "id": "fixture-user-id",
        "email": FIXTURE_EMAIL,
        "password": app_module.bcrypt.generate_password_hash(FIXTURE_PASSWORD).decode("utf-8"),
        "organizations": [],
        "email_verified": verified,
        "otp": FIXTURE_OTP,
        "otp_expires": in_an_hour,
        "otp_attempts": 0,
    }


@pytest.fixture
def verified(monkeypatch):
    accounts = Accounts(_account(verified=True))
    monkeypatch.setattr(UsersApi, "users_collection", accounts)
    return accounts


@pytest.fixture
def unverified(monkeypatch):
    accounts = Accounts(_account(verified=False))
    monkeypatch.setattr(UsersApi, "users_collection", accounts)
    return accounts


@pytest.fixture
def client():
    return app_module.app.test_client()


def _answer(response):
    return response.status_code, response.get_json()


# The password sign-in.

def test_a_wrong_password_says_the_email_and_password_do_not_match(client, verified):
    response = client.post("/login", json={"email": FIXTURE_EMAIL, "password": "not-the-password"})

    assert _answer(response) == (401, {"message": DO_NOT_MATCH})


def test_an_address_with_no_account_answers_as_a_wrong_password_does(client, verified):
    wrong_password = client.post(
        "/login", json={"email": FIXTURE_EMAIL, "password": "not-the-password"})
    no_account = client.post(
        "/login", json={"email": NO_ACCOUNT_EMAIL, "password": "not-the-password"})

    assert _answer(no_account) == _answer(wrong_password)


def test_a_right_password_on_an_unverified_account_says_to_verify_first(client, unverified):
    response = client.post("/login", json={"email": FIXTURE_EMAIL, "password": FIXTURE_PASSWORD})

    assert _answer(response) == (403, {"message": VERIFY_FIRST})


def test_a_wrong_password_on_an_unverified_account_says_only_that_they_do_not_match(
    client, unverified
):
    response = client.post("/login", json={"email": FIXTURE_EMAIL, "password": "not-the-password"})

    assert _answer(response) == (401, {"message": DO_NOT_MATCH})


# The code sign-in.

def test_asking_for_a_code_on_an_unverified_account_says_to_verify_first(client, unverified):
    response = client.post("/request-otp", json={"email": FIXTURE_EMAIL})

    assert _answer(response) == (403, {"msg": VERIFY_FIRST})


def test_the_right_code_on_an_unverified_account_says_to_verify_first(client, unverified):
    response = client.post("/login-otp", json={"email": FIXTURE_EMAIL, "otp": FIXTURE_OTP})

    assert _answer(response) == (403, {"msg": VERIFY_FIRST})


def test_a_code_for_an_address_with_no_account_answers_as_a_wrong_code_does(client, verified):
    no_account = client.post("/login-otp", json={"email": NO_ACCOUNT_EMAIL, "otp": "000000"})
    wrong_code = client.post("/login-otp", json={"email": FIXTURE_EMAIL, "otp": "000000"})

    assert _answer(no_account) == _answer(wrong_code) == (401, {"msg": WRONG_CODE})


# Every answer says "sign in".

@pytest.mark.parametrize(
    "path, body",
    [
        ("/login", {"email": FIXTURE_EMAIL, "password": FIXTURE_PASSWORD}),
        ("/login", {"email": FIXTURE_EMAIL, "password": "not-the-password"}),
        ("/login", {"email": NO_ACCOUNT_EMAIL, "password": "not-the-password"}),
        ("/request-otp", {"email": FIXTURE_EMAIL}),
        ("/login-otp", {"email": FIXTURE_EMAIL, "otp": FIXTURE_OTP}),
        ("/login-otp", {"email": NO_ACCOUNT_EMAIL, "otp": "000000"}),
    ],
)
def test_no_refused_sign_in_says_log_in(client, unverified, path, body):
    words = client.post(path, json=body).get_data(as_text=True).lower()

    assert "log in" not in words
    assert "login" not in words
    assert "logging in" not in words
    assert "invalid credentials" not in words


# Not a refusal.

def test_a_login_id_that_was_not_stored_answers_the_servers_fault(monkeypatch, client, verified):
    """The account was found and the password was right, so this is the server's fault, never
    an answer that the password was wrong."""
    verified.doc["login_id"] = None
    monkeypatch.setattr(verified, "update_one", lambda query, update: None)

    response = client.post("/login", json={"email": FIXTURE_EMAIL, "password": FIXTURE_PASSWORD})

    assert _answer(response) == (500, {"error": "Internal server error"})


# A wrong code, over the tries that follow.

def _wrong_codes(client, email, tries):
    return [_answer(client.post("/login-otp", json={"email": email, "otp": "000000"}))
            for _ in range(tries)]


def test_the_first_four_wrong_codes_answer_alike_with_an_account_or_without(client, verified):
    """Alike up to the fifth: an account's fifth wrong code discards its code and says to ask for
    a new one, which an address with no account has no count for. Counting every address alike is
    the sign-in limits' (E47/F02/S01)."""
    assert _wrong_codes(client, NO_ACCOUNT_EMAIL, 4) == _wrong_codes(client, FIXTURE_EMAIL, 4)


# The password is checked whether or not the address has an account.

def _spy_on_the_password_check(monkeypatch):
    checked = []
    check = app_module.bcrypt.check_password_hash

    def spy(pw_hash, password):
        checked.append(pw_hash)
        return check(pw_hash, password)

    monkeypatch.setattr(app_module.bcrypt, "check_password_hash", spy)
    return checked


def test_a_wrong_password_is_checked_against_the_accounts_hash(monkeypatch, client, verified):
    checked = _spy_on_the_password_check(monkeypatch)

    client.post("/login", json={"email": FIXTURE_EMAIL, "password": "not-the-password"})

    assert checked == [verified.doc["password"]]


def test_an_address_with_no_account_is_checked_against_one_stand_in_hash(
    monkeypatch, client, verified
):
    checked = _spy_on_the_password_check(monkeypatch)

    for _ in range(2):
        client.post("/login", json={"email": NO_ACCOUNT_EMAIL, "password": "not-the-password"})

    assert len(checked) == 2
    assert checked[0] == checked[1], "one hash, made once"
    assert checked[0] != verified.doc["password"]
    # Made at the app's cost factor, so the check takes as long as an account's.
    assert checked[0].split("$")[2] == verified.doc["password"].split("$")[2]
