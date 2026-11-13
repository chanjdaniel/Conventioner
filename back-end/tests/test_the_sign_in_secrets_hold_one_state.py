"""An account's sign-in code and reset link each hold one state, whatever reaches them and when.

A password reset ends every way into the account issued before it, the code among them, and
verifies the address, since following the mailed link proves the mailbox. Two requests for a code
at once mail one code, and one reset link resets once, however close together it is used.

Each test drives the real routes through the Flask test client and reads the code or link from the
mail stand-in, never from the stored account, so it holds whatever shape the account stores them
in. Two requests "at once" are a second request run whole inside the first's window, between the
first's read of the account and its write, by wrapping a function the first calls there.
"""
import copy
import threading
from types import SimpleNamespace

import pytest

from conftest import (
    _find_one_and_update_first, _update_first, mongo_matches, mongo_project,
    skip_without_real_dependencies,
)

skip_without_real_dependencies()

import account_secrets
import app as app_module
import api.users as UsersApi
from test_a_failed_mail_leaves_no_wait_armed import outbox  # noqa: F401
from test_the_organizer_sign_in_is_bounded import (  # noqa: F401
    ACCOUNT_EMAIL, CALLER, FAST_ROUNDS, PASSWORD, UNVERIFIED_EMAIL, _account, client, clock,
    fast_stand_in_hash,
)

NEW_PASSWORD = "fixture-new-password-1"
OTHER_NEW_PASSWORD = "fixture-new-password-2"

WRONG_CODE_SAYS = UsersApi.SIGN_IN_WRONG_CODE
INVALID_RESET = {"msg": "Invalid reset token"}


class Users:
    """The users collection on the suite's shared matcher and update, each write whole under a
    lock as Mongo applies one to a document, so two requests at once meet only in their filters."""

    def __init__(self, *docs):
        self.docs = [copy.deepcopy(doc) for doc in docs]
        self._lock = threading.Lock()

    def find_one(self, query, projection=None):
        with self._lock:
            for doc in self.docs:
                if mongo_matches(doc, query):
                    return mongo_project(copy.deepcopy(doc), projection)
        return None

    def find_one_and_update(self, query, update, projection=None, return_document=False,
                            **_options):
        with self._lock:
            return _find_one_and_update_first(self.docs, query, update, projection,
                                              return_document)

    def update_one(self, query, update, **_options):
        with self._lock:
            return _update_first(self.docs, query, update)

    def insert_one(self, doc):
        with self._lock:
            self.docs.append(copy.deepcopy(doc))
        return SimpleNamespace(inserted_id=doc.get("id"))

    def delete_one(self, query):
        with self._lock:
            for index, doc in enumerate(self.docs):
                if mongo_matches(doc, query):
                    del self.docs[index]
                    return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)


@pytest.fixture
def users(monkeypatch):
    fake = Users(_account(ACCOUNT_EMAIL), _account(UNVERIFIED_EMAIL, verified=False))
    monkeypatch.setattr(UsersApi, "users_collection", fake)
    # A reset hashes its new password at bcrypt's lowest cost, as the accounts here are hashed.
    monkeypatch.setattr(app_module.bcrypt, "_log_rounds", FAST_ROUNDS)
    return fake


def _post(client, path, body):
    return client.post(path, json=body, environ_base={"REMOTE_ADDR": CALLER})


def _ask_for_a_code(client, email=ACCOUNT_EMAIL):
    return _post(client, "/request-otp", {"email": email})


def _enter_code(client, code, email=ACCOUNT_EMAIL):
    return _post(client, "/login-otp", {"email": email, "otp": code})


def _ask_for_a_reset_link(client, email):
    return _post(client, "/request-password-reset", {"email": email})


def _reset(client, link, password):
    return _post(client, "/reset-password", {"token": link, "new_password": password})


def _sign_in(client, email, password):
    return _post(client, "/login", {"email": email, "password": password})


def _mailed(outbox, to):
    """The last code or link mailed to ``to``."""
    return [secret for address, secret in outbox.sent if address == to][-1]


def _inside(first_call, second_request):
    """``first_call`` with ``second_request`` run whole inside its first call, in a thread of its
    own as another request is, before the call itself answers; returns the wrapper and a record
    of the second request's answer, so a test can tell the window was reached."""
    ran = []

    def wrapped(*args, **kwargs):
        if not ran:
            ran.append(None)
            thread = threading.Thread(target=lambda: ran.__setitem__(0, second_request()))
            thread.start()
            thread.join()
        return first_call(*args, **kwargs)

    return wrapped, ran


def fixed_by(reason):
    """A test that fails until the ticket in ``reason`` lands, by an assertion and nothing else; it
    fails the suite once it passes, so that ticket removes the mark."""
    return pytest.mark.xfail(strict=True, raises=AssertionError, reason=reason)


@fixed_by("ticket 03: a password reset ends the account's live code")
def test_a_code_asked_for_before_a_password_reset_is_refused_after_it(
    client, users, outbox, clock,
):
    assert _ask_for_a_code(client).status_code == 200
    code = _mailed(outbox, ACCOUNT_EMAIL)
    assert _ask_for_a_reset_link(client, ACCOUNT_EMAIL).status_code == 200
    assert _reset(client, _mailed(outbox, ACCOUNT_EMAIL), NEW_PASSWORD).status_code == 200

    entered = _enter_code(client, code)

    assert (entered.status_code, entered.get_json()) == (401, {"msg": WRONG_CODE_SAYS})


@fixed_by("ticket 03: a password reset by the mailed link verifies the address")
def test_the_owner_of_an_unverified_address_resets_the_password_and_signs_in(
    client, users, outbox, clock,
):
    assert _ask_for_a_reset_link(client, UNVERIFIED_EMAIL).status_code == 200
    assert _reset(client, _mailed(outbox, UNVERIFIED_EMAIL), NEW_PASSWORD).status_code == 200

    signed_in = _sign_in(client, UNVERIFIED_EMAIL, NEW_PASSWORD)

    assert signed_in.status_code == 200


def test_two_code_requests_at_once_mail_one_code_and_it_signs_in(
    monkeypatch, client, users, outbox, clock,
):
    second_client = app_module.app.test_client()
    # The code is made before the one write that issues it.
    wrapped, second = _inside(account_secrets.generate_otp,
                              lambda: _ask_for_a_code(second_client))
    monkeypatch.setattr(account_secrets, "generate_otp", wrapped)

    first = _ask_for_a_code(client)

    assert second, "the second request never ran inside the first's window"
    answers = sorted([first, second[0]], key=lambda answer: answer.status_code)
    assert [answer.status_code for answer in answers] == [200, 429]
    assert answers[1].get_json()["msg"].startswith("You can ask for a new code in")
    assert len(outbox.sent) == 1
    # The code stored is the one mailed: it signs in.
    assert _enter_code(client, _mailed(outbox, ACCOUNT_EMAIL)).status_code == 200


@fixed_by("ticket 03: a reset link is used in one conditional write")
def test_one_reset_link_used_twice_at_once_resets_once(monkeypatch, client, users, outbox, clock):
    assert _ask_for_a_reset_link(client, ACCOUNT_EMAIL).status_code == 200
    link = _mailed(outbox, ACCOUNT_EMAIL)
    second_client = app_module.app.test_client()
    wrapped, second = _inside(app_module.bcrypt.generate_password_hash,
                              lambda: _reset(second_client, link, OTHER_NEW_PASSWORD))
    monkeypatch.setattr(app_module.bcrypt, "generate_password_hash", wrapped)

    first = _reset(client, link, NEW_PASSWORD)

    assert second, "the second request never ran inside the first's window"
    answers = {NEW_PASSWORD: first, OTHER_NEW_PASSWORD: second[0]}
    assert sorted((answer.status_code, answer.get_json()) for answer in answers.values()) == [
        (200, {"msg": "Password reset successfully"}), (400, INVALID_RESET)]
    # The password stored is the one whose reset was answered 200: it signs in, and the other not.
    reset_to = next(password for password, answer in answers.items() if answer.status_code == 200)
    refused = next(password for password in answers if password != reset_to)
    assert _sign_in(client, ACCOUNT_EMAIL, reset_to).status_code == 200
    assert _sign_in(client, ACCOUNT_EMAIL, refused).status_code == 401
