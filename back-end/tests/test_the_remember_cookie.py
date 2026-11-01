"""How long a sign-in lasts, the cookies that carry it, and a password reset that ends them.

Signing in offers "Remember me" (E38/F14/S01). Unticked, the sign-in sets the session cookie
only, which ends with the browser, and the server refuses it 12 hours after signing in, since a
browser that restores its tabs restores that cookie too. Ticked, it also sets the remember-me
cookie, which signs the account back in once the session has lapsed: it expires 30 days after
signing in, use does not extend it, and the server refuses it then too, whatever the browser kept.

The app and the API are on different hosts, so both cookies are ``SameSite=None``, which a browser
accepts only on a ``Secure`` cookie, and both are ``HttpOnly`` so that no script on the page reads
them.

Both name the sign-in, not the address: the account's login id, whether it was remembered, and
when it was made. A password reset replaces the login id, so every session and remember-me cookie
issued before the reset stops signing in, and a cookie from before the sign-in carried its time is
not read at all.
"""
import os
import sys
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

import pytest
from flask_login.utils import encode_cookie

from conftest import mongo_matches, mongo_project, skip_without_real_dependencies

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

skip_without_real_dependencies()

import app as app_module
import api.users as UsersApi
from utils.session_storage import ON_DISK, install_session_storage


FIXTURE_EMAIL = "fixture-user@example.com"
FIXTURE_PASSWORD = "fixture-password-1"
NEW_PASSWORD = "fixture-password-2"
RESET_TOKEN = "fixture-reset-token"
FIXTURE_OTP = "123456"
REMEMBER_COOKIE = "remember_token"

TWELVE_HOURS = timedelta(hours=12)
THIRTY_DAYS = timedelta(days=30)
A_SECOND = timedelta(seconds=1)


class OneAccount:
    """A users collection holding one account, read and written the way Mongo does."""

    def __init__(self, doc):
        self.doc = dict(doc)
        # Runs before the next update lands, as a concurrent request would.
        self.before_next_update = None

    def find_one(self, query, projection=None):
        if mongo_matches(self.doc, query):
            return mongo_project(dict(self.doc), projection)
        return None

    def update_one(self, query, update):
        if self.before_next_update:
            self.before_next_update, run = None, self.before_next_update
            run()
        if mongo_matches(self.doc, query):
            self.doc.update(update["$set"])


def _in_an_hour():
    return (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()


@pytest.fixture
def users(monkeypatch):
    collection = OneAccount({
        "id": "fixture-user-id",
        "email": FIXTURE_EMAIL,
        "password": app_module.bcrypt.generate_password_hash(FIXTURE_PASSWORD).decode("utf-8"),
        "organizations": [],
        "email_verified": True,
        "password_reset_token": RESET_TOKEN,
        "password_reset_token_expires": _in_an_hour(),
        "otp": FIXTURE_OTP,
        "otp_expires": _in_an_hour(),
        "otp_attempts": 0,
    })
    monkeypatch.setattr(UsersApi, "users_collection", collection)
    return collection


class Clock:
    """The server's clock, which a test moves on instead of waiting."""

    def __init__(self):
        self.now = datetime.now(timezone.utc).timestamp()

    def __call__(self):
        return self.now

    def move_on(self, by: timedelta):
        self.now += by.total_seconds()


@pytest.fixture
def clock(monkeypatch):
    clock = Clock()
    monkeypatch.setattr(UsersApi, "_now", clock)
    return clock


@pytest.fixture
def client():
    return app_module.app.test_client()


def _set_cookies(response, name):
    return [
        header for header in response.headers.getlist("Set-Cookie")
        if header.startswith(f"{name}=")
    ]


def _set_cookie(response, name):
    """The attributes of the ``Set-Cookie`` header for one cookie, lower-cased."""
    headers = _set_cookies(response, name)
    assert len(headers) == 1, f"expected one {name} cookie, got {headers}"
    return [part.strip().lower() for part in headers[0].split(";")[1:]]


def _expires(response, name):
    """When the browser drops the cookie, or None for one that ends with the browser."""
    attributes = _set_cookie(response, name)
    assert not any(a.startswith("max-age=") for a in attributes)
    expires = [a.split("=", 1)[1] for a in attributes if a.startswith("expires=")]
    return parsedate_to_datetime(expires[0]) if expires else None


def _sign_in(client, password=FIXTURE_PASSWORD, remember=None):
    body = {"email": FIXTURE_EMAIL, "password": password}
    if remember is not None:
        body["remember"] = remember
    response = client.post("/login", json=body)
    assert response.status_code == 200
    return response


def _sign_in_remembered(client, password=FIXTURE_PASSWORD):
    return _sign_in(client, password, remember=True)


def _sign_in_with_the_code(client, remember=None):
    body = {"email": FIXTURE_EMAIL, "otp": FIXTURE_OTP}
    if remember is not None:
        body["remember"] = remember
    response = client.post("/login-otp", json=body)
    assert response.status_code == 200
    return response


def _sign_in_with_the_code_remembered(client):
    return _sign_in_with_the_code(client, remember=True)


def _reopened(client):
    """A fresh client, as a browser reopened: it kept the remember-me cookie, and no session."""
    fresh = app_module.app.test_client()
    kept = client.get_cookie(REMEMBER_COOKIE)
    if kept is not None:
        fresh.set_cookie(REMEMBER_COOKIE, kept.value)
    return fresh


def _signed_in(client):
    return client.get("/check-session").status_code == 200


def _reset_the_password():
    response = app_module.app.test_client().post(
        "/reset-password", json={"token": RESET_TOKEN, "new_password": NEW_PASSWORD})
    assert response.status_code == 200


# The cookies' settings.

@pytest.mark.parametrize("cookie", [REMEMBER_COOKIE, "session"])
def test_signing_in_sets_the_cookie_secure_samesite_none_and_httponly(client, users, cookie):
    attributes = _set_cookie(_sign_in_remembered(client), cookie)

    assert "secure" in attributes
    assert "samesite=none" in attributes
    assert "httponly" in attributes


@pytest.mark.parametrize("remember", [True, None], ids=["ticked", "unticked"])
def test_the_session_cookie_ends_with_the_browser(client, users, remember):
    assert _expires(_sign_in(client, remember=remember), "session") is None


# Unticked: the session only, for 12 hours at the most.

@pytest.mark.parametrize("remember", [None, False, "true", 1, "yes"],
                         ids=["absent", "false", "the-string-true", "one", "yes"])
def test_an_unticked_sign_in_sets_no_remember_cookie(client, users, remember):
    response = _sign_in(client, remember=remember)

    assert _set_cookies(response, REMEMBER_COOKIE) == []
    assert _signed_in(client)
    assert not _signed_in(_reopened(client))


def test_an_unticked_sign_in_by_code_sets_no_remember_cookie(client, users):
    assert _set_cookies(_sign_in_with_the_code(client), REMEMBER_COOKIE) == []


def test_an_unticked_session_lasts_until_twelve_hours_after_signing_in(client, users, clock):
    _sign_in(client)

    clock.move_on(TWELVE_HOURS - A_SECOND)
    assert _signed_in(client)
    clock.move_on(A_SECOND)
    assert not _signed_in(client)


def test_use_does_not_extend_an_unticked_session(client, users, clock):
    _sign_in(client)
    for _ in range(11):
        clock.move_on(timedelta(hours=1))
        assert _signed_in(client)

    clock.move_on(timedelta(hours=1))
    assert not _signed_in(client)


def test_an_unticked_sign_in_forgets_a_browser_remembered_before(client, users):
    _sign_in_remembered(client)
    assert client.get_cookie(REMEMBER_COOKIE) is not None

    _sign_in(client, remember=False)

    assert client.get_cookie(REMEMBER_COOKIE) is None
    assert _signed_in(client)
    assert not _signed_in(_reopened(client))


# Ticked: 30 days from signing in, on the cookie and on the server.

@pytest.mark.parametrize("sign_in", [_sign_in_remembered, _sign_in_with_the_code_remembered],
                         ids=["password", "code"])
def test_a_ticked_sign_in_sets_a_remember_cookie_that_expires_in_thirty_days(
    client, users, sign_in
):
    before = datetime.now(timezone.utc)
    response = sign_in(client)

    expires = _expires(response, REMEMBER_COOKIE)
    assert before + THIRTY_DAYS - timedelta(minutes=1) <= expires
    assert expires <= datetime.now(timezone.utc) + THIRTY_DAYS
    assert _signed_in(_reopened(client))


def test_a_ticked_session_outlasts_twelve_hours(client, users, clock):
    _sign_in_remembered(client)

    clock.move_on(TWELVE_HOURS + timedelta(hours=1))

    assert _signed_in(client)


def test_the_server_refuses_a_remember_cookie_thirty_days_after_signing_in(client, users, clock):
    _sign_in_remembered(client)

    clock.move_on(THIRTY_DAYS - A_SECOND)
    assert _signed_in(_reopened(client))
    assert _signed_in(client)
    clock.move_on(A_SECOND)
    assert not _signed_in(_reopened(client))
    assert not _signed_in(client)


def test_signing_back_in_by_the_remember_cookie_does_not_extend_it(client, users, clock):
    _sign_in_remembered(client)
    clock.move_on(timedelta(days=29))
    reopened = _reopened(client)
    assert _signed_in(reopened)

    clock.move_on(timedelta(days=1))

    assert not _signed_in(reopened)
    assert not _signed_in(_reopened(reopened))


def test_a_browser_signed_back_in_by_the_remember_cookie_stays_signed_in(client, users):
    _sign_in_remembered(client)
    reopened = _reopened(client)

    # Each request after the first, too: the session the cookie restored is held to the browser
    # as a signed-in one is, not refused at the next request with the cookie deleted.
    assert [_signed_in(reopened) for _ in range(3)] == [True, True, True]
    assert reopened.get_cookie(REMEMBER_COOKIE) is not None


def test_a_restored_session_carried_to_another_browser_is_refused(client, users):
    _sign_in_remembered(client)
    reopened = _reopened(client)
    assert _signed_in(reopened)

    # The session protection's "strong" mode still holds it to the browser that restored it.
    elsewhere = reopened.get("/check-session", headers={"User-Agent": "another-browser"})

    assert elsewhere.status_code == 401


def _without_the_user_agent(client, path):
    """A request whose header block ended before its User-Agent, as a connection cut mid-request
    delivers one: the server reads what came as the whole request (T177)."""
    kept = client.environ_base.pop("HTTP_USER_AGENT")
    try:
        return client.get(path)
    finally:
        client.environ_base["HTTP_USER_AGENT"] = kept


@pytest.mark.parametrize("remember", [False, True])
@pytest.mark.parametrize(
    "odd_request",
    [
        _without_the_user_agent,
        lambda client, path: client.get(path, headers={"User-Agent": "another-browser"}),
    ],
    ids=["without-a-user-agent", "from-another-browser"],
)
def test_one_odd_request_is_refused_and_does_not_end_the_sign_in(
    client, users, remember, odd_request
):
    _sign_in(client, remember=remember)
    assert _signed_in(client)

    # Refused, as "strong" refuses another client, but nothing is deleted: the browser that signed
    # in is still signed in at its next request, so one request the server could not hold to it
    # is not a sign-out (T177).
    odd = odd_request(client, "/check-session")

    assert odd.status_code == 401
    assert not _set_cookies(odd, "session") and not _set_cookies(odd, REMEMBER_COOKIE)
    assert [_signed_in(client) for _ in range(2)] == [True, True]


def test_a_copied_session_cookie_is_refused_at_every_request(client, users):
    _sign_in(client)
    copied = app_module.app.test_client()
    copied.set_cookie("session", client.get_cookie("session").value)

    assert [
        copied.get("/check-session", headers={"User-Agent": "another-browser"}).status_code
        for _ in range(3)
    ] == [401, 401, 401]
    assert _signed_in(client)


@pytest.fixture
def on_disk(monkeypatch, tmp_path):
    """The app keeping its sessions on disk, as a container, the stack and CI do, in ``tmp_path``.

    There the session is a file on the server, so whatever a request does to it holds whether or
    not anyone reads the answer. Returns the stored session behind a session cookie.
    """
    flask_app = app_module.app
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(flask_app, "session_interface", flask_app.session_interface)
    for key in ("SESSION_TYPE", "SESSION_CACHELIB"):
        monkeypatch.setitem(flask_app.config, key, None)
    install_session_storage(flask_app, ON_DISK)

    def stored(sid):
        interface = flask_app.session_interface
        return interface._retrieve_session_data(interface._get_store_id(sid))

    return stored


@pytest.mark.parametrize("remember", [False, True])
def test_an_unread_answer_to_one_odd_request_does_not_end_the_sign_in_on_disk(
    users, on_disk, remember
):
    browser = app_module.app.test_client()
    _sign_in(browser, remember=remember)
    sid = browser.get_cookie("session").value
    assert on_disk(sid)["_user_id"]

    # The same cookies arrive without the User-Agent, as a connection cut mid-request delivers
    # them, and nobody reads the answer: the browser never hears what it said (T177).
    cut_short = app_module.app.test_client()
    for name in ("session", REMEMBER_COOKIE):
        if browser.get_cookie(name) is not None:
            cut_short.set_cookie(name, browser.get_cookie(name).value)
    assert _without_the_user_agent(cut_short, "/check-session").status_code == 401

    assert (on_disk(sid) or {}).get("_user_id"), "the stored session was deleted"
    assert [_signed_in(browser) for _ in range(2)] == [True, True]


def test_a_permanent_session_from_another_browser_is_refused_too(client, users):
    # Flask-Login only marks a permanent session not fresh under "strong"; this app refuses it like
    # any other, though no sign-in makes one permanent.
    _sign_in(client)
    with client.session_transaction() as held:
        held.permanent = True

    elsewhere = client.get("/check-session", headers={"User-Agent": "another-browser"})

    assert elsewhere.status_code == 401
    assert _signed_in(client)


# What came before, and a password reset.

def test_a_remember_cookie_issued_before_the_lengths_is_not_read(client, users):
    _sign_in(client)
    before = app_module.app.test_client()
    with app_module.app.test_request_context():
        # The cookie a sign-in set until now: the bare login id, signed.
        before.set_cookie(REMEMBER_COOKIE, encode_cookie(users.doc["login_id"]))

    assert not _signed_in(before)


@pytest.mark.parametrize("held", ["a-sign-in", "the-bare-login-id", "the-address"])
def test_a_session_is_read_only_as_a_sign_in(monkeypatch, client, users, clock, held):
    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    users.doc["login_id"] = "fixture-login-id"
    held_id = {
        "a-sign-in": f"fixture-login-id.s.{int(clock.now)}",
        "the-bare-login-id": "fixture-login-id",
        "the-address": FIXTURE_EMAIL,
    }[held]
    with client.session_transaction() as session:
        session["_user_id"] = held_id
        session["_fresh"] = True

    assert _signed_in(client) == (held == "a-sign-in")


@pytest.mark.parametrize("held", [
    "fixture-login-id.x.0", "fixture-login-id.s.", "fixture-login-id.s.-1",
    "fixture-login-id.s.1e9", "fixture-login-id.s.²", ".s.0", "", None, 7,
])
def test_a_sign_in_of_any_other_shape_loads_no_one(users, clock, held):
    users.doc["login_id"] = "fixture-login-id"

    assert UsersApi.signed_in_account(held) is None


@pytest.mark.parametrize("remember", [True, None], ids=["ticked", "unticked"])
def test_a_password_reset_ends_every_session_and_remember_cookie_issued_before_it(
    client, users, remember
):
    _sign_in(client, remember=remember)
    reopened = _reopened(client)

    _reset_the_password()

    assert not _signed_in(reopened)
    assert not _signed_in(client)


def test_signing_in_after_a_reset_works_at_once(users):
    _sign_in_remembered(app_module.app.test_client())
    _reset_the_password()

    client = app_module.app.test_client()
    _sign_in_remembered(client, NEW_PASSWORD)

    assert _signed_in(client)
    assert _signed_in(_reopened(client))


# The login id.

@pytest.mark.parametrize("sign_in", [_sign_in, _sign_in_with_the_code], ids=["password", "code"])
def test_an_account_without_a_login_id_gets_one_at_its_first_sign_in_and_keeps_it(users, sign_in):
    assert "login_id" not in users.doc

    sign_in(app_module.app.test_client())
    login_id = users.doc["login_id"]
    _sign_in(app_module.app.test_client())

    assert isinstance(login_id, str) and len(login_id) >= 32
    assert users.doc["login_id"] == login_id


def test_two_first_sign_ins_at_once_agree_on_the_login_id(client, users):
    # The other sign-in writes its login id between this one's read and its write.
    users.before_next_update = lambda: users.doc.update(login_id="the-other-sign-in")
    _sign_in(client)

    assert users.doc["login_id"] == "the-other-sign-in"
    assert _signed_in(client)
