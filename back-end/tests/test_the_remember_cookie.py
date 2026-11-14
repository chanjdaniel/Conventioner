"""How long a sign-in lasts, the cookies that carry it, and what ends it on the server (ADR 0029).

Signing in offers "Remember me" (E38/F14/S01). Unticked, the sign-in sets the session cookie
only, which ends with the browser, and the server ends the sign-in 12 hours after it was made,
since a browser that restores its tabs restores that cookie too. Ticked, it also sets the remember
cookie, ``__Host-organizer_remember``, which signs the account back in once the session has lapsed:
it expires 30 days after signing in, use does not extend it, and the server ends the sign-in then
too, whatever the browser kept.

The app and the API are on two hosts of one site, so both cookies are ``SameSite=Lax``: the browser
sends them on the app's requests to the API and keeps neither from another site's. Both are
``Secure`` and ``HttpOnly``, so that no script on the page reads them. The remember cookie's ``__Host-`` prefix holds it to the API's host: a browser takes it, or
its deletion, only with ``Secure``, ``Path=/`` and no ``Domain``.

Every sign-in is kept on the server (``organizer_sessions``): both cookies carry a random secret,
and the server keeps its hash beside the account, the login id and when the sign-in ends. Signing
out ends it there, a new sign-in in the browser ends the one it held, and Sign out everywhere and
a password reset end every one of the account's, so a copy of the browser's cookies stops working
too.

Every sign-in starts a fresh session, by password, by code or by the remember cookie, in the signed
cookie and in the store on disk alike, so no session cookie issued before it carries the sign-in.

For one release, a sign-in made before sign-ins were kept on the server still signs in: its id
names the login id, the kind and the time, in the session or in the ``remember_token`` cookie. A
replaced login id ends it, and a sign-in or sign-out deletes the old cookie.
"""
import copy
import hashlib
import os
import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from email.utils import parsedate_to_datetime

import pytest
from flask_login.utils import decode_cookie, encode_cookie
from pymongo.errors import PyMongoError

from conftest import mongo_matches, mongo_project, mongo_update, skip_without_real_dependencies

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

skip_without_real_dependencies()

import app as app_module
import api.users as UsersApi
import organizer_sessions as OrganizerSessions
from sign_in_secrets import live_code, live_link
from utils.session_storage import ON_DISK, install_session_storage


FIXTURE_EMAIL = "fixture-user@example.com"
FIXTURE_PASSWORD = "fixture-password-1"
NEW_PASSWORD = "fixture-password-2"
RESET_TOKEN = "fixture-reset-token"
FIXTURE_OTP = "123456"
REMEMBER_COOKIE = "__Host-organizer_remember"
LEGACY_REMEMBER_COOKIE = "remember_token"

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

    def find_one_and_update(self, query, update, projection=None, return_document=None,
                            **_options):
        if not mongo_matches(self.doc, query):
            return None
        before = self.doc
        self._apply(update)
        return mongo_project(copy.deepcopy(self.doc if return_document else before), projection)

    def update_one(self, query, update, **_options):
        if self.before_next_update:
            self.before_next_update, run = None, self.before_next_update
            run()
        if not mongo_matches(self.doc, query):
            return SimpleNamespace(matched_count=0, modified_count=0)
        self._apply(update)
        return SimpleNamespace(matched_count=1, modified_count=1)

    def _apply(self, update):
        self.doc = mongo_update(self.doc, update)


@pytest.fixture
def users(monkeypatch):
    collection = OneAccount({
        "id": "fixture-user-id",
        "email": FIXTURE_EMAIL,
        "password": app_module.bcrypt.generate_password_hash(FIXTURE_PASSWORD).decode("utf-8"),
        "organizations": [],
        "email_verified": True,
        "secrets": {"code": live_code(FIXTURE_OTP), "reset": live_link(RESET_TOKEN)},
    })
    monkeypatch.setattr(UsersApi, "users_collection", collection)
    return collection


class Clock:
    """The server's clock, which a test moves on instead of waiting: the sign-ins' and the
    sign-in limits' alike."""

    def __init__(self):
        self.now = datetime.now(timezone.utc).timestamp()

    def __call__(self):
        return self.now

    def moment(self) -> datetime:
        return datetime.fromtimestamp(self.now, tz=timezone.utc)

    def move_on(self, by: timedelta):
        self.now += by.total_seconds()


@pytest.fixture
def clock(monkeypatch):
    clock = Clock()
    monkeypatch.setattr(UsersApi, "_now", clock)
    monkeypatch.setattr(OrganizerSessions, "now", clock.moment)
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


def _deletes(response, name) -> bool:
    """Whether the answer tells the browser to drop the cookie."""
    headers = _set_cookies(response, name)
    if len(headers) != 1:
        return False
    attributes = _set_cookie(response, name)
    expires = [a.split("=", 1)[1] for a in attributes if a.startswith("expires=")]
    return (headers[0].startswith(f"{name}=;") and bool(expires)
            and parsedate_to_datetime(expires[0]) <= datetime.now(timezone.utc))


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


def _sign_out(client):
    response = client.post("/logout")
    assert response.status_code == 200
    return response


def _reopened(client):
    """A fresh client, as a browser reopened: it kept the remember cookie, and no session."""
    fresh = app_module.app.test_client()
    kept = client.get_cookie(REMEMBER_COOKIE)
    if kept is not None:
        fresh.set_cookie(REMEMBER_COOKIE, kept.value)
    return fresh


def _copied(client):
    """A fresh client holding a copy of every cookie the browser holds, sent from the same
    address and browser, so the session protection cannot tell it apart."""
    copy_of = app_module.app.test_client()
    for name in ("session", REMEMBER_COOKIE, LEGACY_REMEMBER_COOKIE):
        kept = client.get_cookie(name)
        if kept is not None:
            copy_of.set_cookie(name, kept.value)
    return copy_of


def _session_copied(client):
    """A fresh client holding a copy of the session cookie alone."""
    copy_of = app_module.app.test_client()
    copy_of.set_cookie("session", client.get_cookie("session").value)
    return copy_of


def _signed_in(client):
    return client.get("/check-session").status_code == 200


def _reset_the_password():
    response = app_module.app.test_client().post(
        "/reset-password", json={"token": RESET_TOKEN, "new_password": NEW_PASSWORD})
    assert response.status_code == 200


def _secret_of(client):
    """The secret the browser's session carries."""
    with client.session_transaction() as held:
        return held.get("_user_id")


def _hash(secret):
    return hashlib.sha256(secret.encode()).hexdigest()


# The cookies' settings.

@pytest.mark.parametrize("sign_in", [_sign_in_remembered, _sign_in_with_the_code_remembered],
                         ids=["password", "code"])
@pytest.mark.parametrize("cookie", [REMEMBER_COOKIE, "session"])
def test_signing_in_sets_the_cookie_secure_samesite_lax_and_httponly(
    client, users, cookie, sign_in
):
    attributes = _set_cookie(sign_in(client), cookie)

    assert "secure" in attributes
    assert "samesite=lax" in attributes
    assert "httponly" in attributes


@pytest.mark.parametrize("answer", [
    lambda client: (_sign_in_remembered(client), _sign_out(client))[1],
    lambda client: (_sign_in_remembered(client), _sign_out_everywhere(client))[1],
    lambda client: _unticked_after_remembered(client),
], ids=["sign-out", "sign-out-everywhere", "an-unticked-sign-in"])
def test_deleting_the_remember_cookie_names_the_same_attributes(client, users, answer):
    response = answer(client)

    assert _deletes(response, REMEMBER_COOKIE)
    attributes = _set_cookie(response, REMEMBER_COOKIE)
    assert "secure" in attributes
    assert "samesite=lax" in attributes
    assert "httponly" in attributes


def _unticked_after_remembered(client):
    _sign_in_remembered(client)
    return _sign_in(client, remember=False)


@pytest.mark.parametrize("answer", [
    _sign_in_remembered,
    lambda client: (_sign_in_remembered(client), _sign_out(client))[1],
    _unticked_after_remembered,
], ids=["set-by-a-sign-in", "deleted-by-sign-out", "deleted-by-an-unticked-sign-in"])
def test_the_remember_cookie_meets_the_host_prefixs_terms(client, users, answer):
    # A browser takes a __Host- cookie, and its deletion, only with Secure, Path=/ and no Domain.
    attributes = _set_cookie(answer(client), REMEMBER_COOKIE)

    assert "secure" in attributes
    assert "path=/" in attributes
    assert not any(a.startswith("domain=") for a in attributes)
    assert "httponly" in attributes


@pytest.mark.parametrize("remember", [True, None], ids=["ticked", "unticked"])
def test_the_session_cookie_ends_with_the_browser(client, users, remember):
    assert _expires(_sign_in(client, remember=remember), "session") is None


# Each sign-in kept on the server.

@pytest.mark.parametrize("remember", [True, False], ids=["ticked", "unticked"])
def test_a_sign_in_is_kept_on_the_server_by_the_hash_of_what_the_browser_holds(
    client, users, organizer_sessions, clock, remember
):
    response = _sign_in(client, remember=remember)
    secret = _secret_of(client)

    [kept] = organizer_sessions.documents
    assert kept == {
        "_id": _hash(secret),
        "user_id": "fixture-user-id",
        "login_id": users.doc["login_id"],
        "remembered": remember,
        "created_at": clock.moment(),
        "expires_at": clock.moment() + (THIRTY_DAYS if remember else TWELVE_HOURS),
    }
    assert "." not in secret and len(secret) >= 43
    if remember:
        with app_module.app.app_context():
            assert decode_cookie(client.get_cookie(REMEMBER_COOKIE).value) == secret
    else:
        assert _set_cookies(response, REMEMBER_COOKIE) == []


def test_a_sign_in_ends_when_its_record_says(client, users, organizer_sessions, clock):
    _sign_in_remembered(client)
    [kept] = organizer_sessions.documents
    kept["expires_at"] = clock.moment() + timedelta(minutes=1)

    assert _signed_in(client)
    clock.move_on(timedelta(minutes=1))
    assert not _signed_in(client)
    assert not _signed_in(_reopened(client))


def test_a_sign_in_whose_record_is_gone_loads_no_one(client, users, organizer_sessions):
    _sign_in_remembered(client)

    organizer_sessions.documents.clear()

    assert not _signed_in(client)
    assert not _signed_in(_reopened(client))


def test_a_record_names_the_login_id_it_was_made_under(client, users):
    # The account's login id replaced, as a password reset does in its one write: every sign-in
    # issued before ends at once, whatever records are left.
    _sign_in_remembered(client)

    users.doc["login_id"] = "fixture-replaced-login-id"

    assert not _signed_in(client)
    assert not _signed_in(_reopened(client))


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


def test_an_unticked_sign_in_forgets_a_browser_remembered_before_on_the_server_too(
    client, users, organizer_sessions
):
    _sign_in_remembered(client)
    remembered_before = _reopened(client)
    assert remembered_before.get_cookie(REMEMBER_COOKIE) is not None

    response = _sign_in(client, remember=False)

    assert _deletes(response, REMEMBER_COOKIE)
    assert client.get_cookie(REMEMBER_COOKIE) is None
    assert _signed_in(client)
    assert not _signed_in(_reopened(client))
    # A copy of the cookie kept from before is ended on the server.
    assert not _signed_in(remembered_before)
    assert [kept["remembered"] for kept in organizer_sessions.documents] == [False]


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
    copied = _session_copied(client)

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


@pytest.mark.parametrize("remember", [False, True])
def test_a_read_in_flight_across_a_sign_in_on_disk_keeps_the_new_sign_in(
    users, on_disk, monkeypatch, remember
):
    # The page's reads are still in flight when the same browser signs in again, as a page loading
    # under a second sign-in does: the read loaded the session before the sign-in and answers after
    # it, and must not write the ended sign-in back over the new one.
    browser = app_module.app.test_client()
    _sign_in(browser, remember=remember)
    same_browser = _copied(browser)
    loads = UsersApi.signed_in_account
    signed_in_meanwhile = []

    def a_sign_in_lands_meanwhile(sign_in):
        account = loads(sign_in)
        if not signed_in_meanwhile:
            signed_in_meanwhile.append(_sign_in(same_browser, remember=remember))
        return account

    monkeypatch.setattr(UsersApi, "signed_in_account", a_sign_in_lands_meanwhile)
    assert browser.get("/check-session").status_code == 200
    monkeypatch.setattr(UsersApi, "signed_in_account", loads)

    assert signed_in_meanwhile, "the sign-in never landed inside the read"
    assert [_signed_in(same_browser) for _ in range(2)] == [True, True]


def test_a_permanent_session_from_another_browser_is_refused_too(client, users):
    # Flask-Login only marks a permanent session not fresh under "strong"; this app refuses it like
    # any other, though no sign-in makes one permanent.
    _sign_in(client)
    with client.session_transaction() as held:
        held.permanent = True

    elsewhere = client.get("/check-session", headers={"User-Agent": "another-browser"})

    assert elsewhere.status_code == 401
    assert _signed_in(client)


# What ends a sign-in, for the browser and for a copy of its cookies.

@pytest.mark.parametrize("remember", [True, False], ids=["ticked", "unticked"])
def test_signing_out_ends_the_sign_in_on_the_server(client, users, organizer_sessions, remember):
    _sign_in(client, remember=remember)
    copied, reopened = _copied(client), _reopened(client)
    assert _signed_in(copied)

    _sign_out(client)

    assert organizer_sessions.documents == []
    assert not _signed_in(client)
    assert not _signed_in(copied)
    assert not _signed_in(reopened)


def test_a_copied_session_cookie_is_refused_after_sign_out(client, users):
    _sign_in(client)
    copied = _session_copied(client)
    assert _signed_in(copied)

    _sign_out(client)

    assert not _signed_in(copied)


def test_a_copied_remember_cookie_is_refused_after_sign_out(client, users):
    _sign_in_remembered(client)
    copied = _reopened(client)

    _sign_out(client)

    assert not _signed_in(copied)


def test_signing_out_ends_this_browsers_sign_in_only(users, organizer_sessions):
    here, elsewhere = app_module.app.test_client(), app_module.app.test_client()
    _sign_in_remembered(here)
    _sign_in_remembered(elsewhere)

    _sign_out(here)

    assert len(organizer_sessions.documents) == 1
    assert _signed_in(elsewhere)
    assert _signed_in(_reopened(elsewhere))


@pytest.mark.parametrize("sign_in", [_sign_in, _sign_in_remembered, _sign_in_with_the_code],
                         ids=["unticked", "ticked", "code"])
def test_a_sign_in_ends_the_one_the_browser_held_before(
    client, users, organizer_sessions, sign_in
):
    _sign_in_remembered(client)
    copied = _copied(client)

    sign_in(client)

    assert not _signed_in(copied)
    assert not _signed_in(_reopened(copied))
    assert _signed_in(client)
    assert len(organizer_sessions.documents) == 1


def test_a_sign_in_ends_whoevers_sign_in_the_browser_held(client, users, organizer_sessions):
    # A browser remembered for someone else, then signed in to this account.
    someone_elses = OrganizerSessions.start("fixture-other-user-id", "fixture-other-login-id", True)
    with client.session_transaction() as held:
        held["_user_id"] = someone_elses
    with app_module.app.test_request_context():
        client.set_cookie(REMEMBER_COOKIE, encode_cookie(someone_elses))

    _sign_in(client)

    assert [kept["user_id"] for kept in organizer_sessions.documents] == ["fixture-user-id"]
    assert OrganizerSessions.recall(someone_elses) is None


def test_a_refused_sign_in_leaves_the_browsers_sign_in(client, users):
    _sign_in_remembered(client)

    refused = client.post("/login", json={"email": FIXTURE_EMAIL, "password": "fixture-wrong-1"})

    assert refused.status_code == 401
    assert _signed_in(client)
    assert _signed_in(_reopened(client))


# Every sign-in starts a fresh session, on each store the app keeps sessions in.

@pytest.fixture(params=["in-the-cookie", "on-disk"])
def every_store(request):
    """Each session store a deployment may name: the signed cookie (``null``), which the tests'
    app keeps, and the store on disk (``filesystem``). Returns the stored session behind a session
    cookie on disk, and None in the cookie, where nothing is stored."""
    if request.param == "on-disk":
        return request.getfixturevalue("on_disk")
    return None


@pytest.mark.parametrize("sign_in", [_sign_in, _sign_in_remembered, _sign_in_with_the_code],
                         ids=["unticked", "ticked", "code"])
def test_a_sign_in_starts_a_fresh_session_on_every_store(users, every_store, sign_in):
    browser = app_module.app.test_client()
    _sign_in(browser)
    earlier = _session_copied(browser)
    earlier_sid = earlier.get_cookie("session").value

    sign_in(browser)

    assert browser.get_cookie("session").value != earlier_sid
    assert _signed_in(browser)
    assert not _signed_in(earlier)
    if every_store is not None:
        assert every_store(earlier_sid) is None, "the earlier session is still stored"


def _a_live_remember_cookie(users, clock):
    remembered = app_module.app.test_client()
    _sign_in_remembered(remembered)
    return REMEMBER_COOKIE, remembered.get_cookie(REMEMBER_COOKIE).value


def _a_live_legacy_remember_cookie(users, clock):
    with app_module.app.test_request_context():
        return LEGACY_REMEMBER_COOKIE, encode_cookie(_legacy_sign_in_id(users, clock))


@pytest.mark.parametrize("remember_cookie", [_a_live_remember_cookie,
                                             _a_live_legacy_remember_cookie],
                         ids=["remember-cookie", "legacy-remember-cookie"])
def test_signing_back_in_by_the_remember_cookie_starts_a_fresh_session_on_every_store(
    users, clock, every_store, remember_cookie
):
    # A browser holding a session whose sign-in has ended, beside a remember cookie that is live.
    name, value = remember_cookie(users, clock)
    browser = app_module.app.test_client()
    _sign_in(browser)
    OrganizerSessions.end(_secret_of(browser))
    browser.set_cookie(name, value)
    earlier = _session_copied(browser)
    earlier_sid = earlier.get_cookie("session").value

    assert [_signed_in(browser) for _ in range(2)] == [True, True]

    assert browser.get_cookie("session").value != earlier_sid
    assert not _signed_in(earlier)
    if every_store is not None:
        assert every_store(earlier_sid) is None, "the earlier session is still stored"


def test_signing_out_ends_the_session_cookie_on_every_store(users, every_store):
    browser = app_module.app.test_client()
    _sign_in(browser)
    earlier = _session_copied(browser)
    earlier_sid = earlier.get_cookie("session").value

    _sign_out(browser)

    assert not _signed_in(browser)
    assert not _signed_in(earlier)
    if every_store is not None:
        assert every_store(earlier_sid) is None, "the session is still stored"


@pytest.mark.parametrize("remember", [True, None], ids=["ticked", "unticked"])
def test_a_password_reset_ends_every_session_and_remember_cookie_issued_before_it(
    client, users, organizer_sessions, remember
):
    _sign_in(client, remember=remember)
    copied, reopened = _copied(client), _reopened(client)

    _reset_the_password()

    assert organizer_sessions.documents == []
    assert not _signed_in(reopened)
    assert not _signed_in(copied)
    assert not _signed_in(client)


def _sign_out_everywhere(client):
    response = client.post("/logout-everywhere")
    assert (response.status_code, response.get_json()) == (200, {"message": "Signed out everywhere"})
    return response


def test_signing_out_everywhere_ends_every_sign_in_of_the_account(
    users, organizer_sessions, clock
):
    # Before the release, a browser remembered under the old shape, and the session it restored.
    legacy = _a_browser_with_the_legacy_remember_cookie(_legacy_sign_in_id(users, clock))
    assert _signed_in(legacy)
    legacy_session = _session_copied(legacy)
    here, ticked, by_code = (app_module.app.test_client() for _ in range(3))
    _sign_in(here)
    _sign_in_remembered(ticked)
    _sign_in_with_the_code_remembered(by_code)
    held = [here, _copied(here), ticked, _copied(ticked), _reopened(ticked), by_code,
            _reopened(by_code), legacy, legacy_session]
    assert all(_signed_in(browser) for browser in held)
    login_id = users.doc["login_id"]

    _sign_out_everywhere(here)

    assert organizer_sessions.documents == []
    assert users.doc["login_id"] not in (None, login_id)
    assert [_signed_in(browser) for browser in held] == [False] * len(held)


def test_signing_out_everywhere_leaves_another_accounts_sign_ins(client, users,
                                                                  organizer_sessions):
    someone_elses = OrganizerSessions.start("fixture-other-user-id", "fixture-other-login-id", True)
    _sign_in(client)

    _sign_out_everywhere(client)

    assert [kept["user_id"] for kept in organizer_sessions.documents] == ["fixture-other-user-id"]
    assert OrganizerSessions.recall(someone_elses) == ("fixture-other-user-id",
                                                       "fixture-other-login-id")


@pytest.mark.parametrize("remember", [True, None], ids=["ticked", "unticked"])
def test_signing_out_everywhere_clears_this_browsers_cookies(client, users, remember):
    _sign_in(client, remember=remember)

    response = _sign_out_everywhere(client)

    assert not _signed_in(client)
    assert client.get_cookie(REMEMBER_COOKIE) is None
    if remember:
        assert _deletes(response, REMEMBER_COOKIE)
        # A browser takes a __Host- cookie's deletion only with Secure, Path=/ and no Domain.
        attributes = _set_cookie(response, REMEMBER_COOKIE)
        assert "secure" in attributes and "path=/" in attributes
        assert not any(a.startswith("domain=") for a in attributes)


def test_signing_out_everywhere_deletes_the_legacy_remember_cookie(users, clock):
    browser = _a_browser_with_the_legacy_remember_cookie(_legacy_sign_in_id(users, clock))
    assert _signed_in(browser)

    response = _sign_out_everywhere(browser)

    assert _deletes(response, LEGACY_REMEMBER_COOKIE)
    assert browser.get_cookie(LEGACY_REMEMBER_COOKIE) is None


@pytest.mark.parametrize("sign_in", [_sign_in, _sign_in_remembered, _sign_in_with_the_code],
                         ids=["unticked", "ticked", "code"])
def test_signing_in_after_signing_out_everywhere_works_at_once(users, sign_in):
    first = app_module.app.test_client()
    _sign_in_remembered(first)
    _sign_out_everywhere(first)

    client = app_module.app.test_client()
    sign_in(client)

    assert _signed_in(client)


def test_signing_out_everywhere_that_fails_leaves_every_sign_in(monkeypatch, client, users,
                                                                organizer_sessions):
    elsewhere = app_module.app.test_client()
    _sign_in_remembered(elsewhere)
    _sign_in(client)

    def the_database_is_gone(*_args, **_kwargs):
        raise PyMongoError("fixture: the database did not answer")

    monkeypatch.setattr(users, "update_one", the_database_is_gone)
    response = client.post("/logout-everywhere")

    assert response.status_code == 500
    assert "fixture" not in response.get_data(as_text=True)
    assert len(organizer_sessions.documents) == 2
    assert _signed_in(client)
    assert _signed_in(elsewhere)


def test_signing_out_everywhere_signed_out_is_refused(client, users, organizer_sessions):
    elsewhere = app_module.app.test_client()
    _sign_in_remembered(elsewhere)
    login_id = users.doc["login_id"]

    response = client.post("/logout-everywhere")

    assert response.status_code == 401
    assert users.doc["login_id"] == login_id
    assert len(organizer_sessions.documents) == 1
    assert _signed_in(elsewhere)


def test_signing_in_after_a_reset_works_at_once(users):
    _sign_in_remembered(app_module.app.test_client())
    _reset_the_password()

    client = app_module.app.test_client()
    _sign_in_remembered(client, NEW_PASSWORD)

    assert _signed_in(client)
    assert _signed_in(_reopened(client))


# A sign-in made before sign-ins were kept on the server, read for one release.

def _legacy_sign_in_id(users, clock, kind="r"):
    users.doc["login_id"] = "fixture-login-id"
    return f"fixture-login-id.{kind}.{int(clock.now)}"


def _a_browser_with_the_legacy_remember_cookie(sign_in_id):
    browser = app_module.app.test_client()
    with app_module.app.test_request_context():
        browser.set_cookie(LEGACY_REMEMBER_COOKIE, encode_cookie(sign_in_id))
    return browser


def test_a_legacy_remember_cookie_still_signs_in_and_stays_signed_in(users, clock):
    browser = _a_browser_with_the_legacy_remember_cookie(_legacy_sign_in_id(users, clock))

    # Held to the browser it restored, as the remember cookie's own restore is.
    assert [_signed_in(browser) for _ in range(3)] == [True, True, True]
    elsewhere = browser.get("/check-session", headers={"User-Agent": "another-browser"})
    assert elsewhere.status_code == 401


def test_a_legacy_remember_cookie_ends_thirty_days_after_its_sign_in(users, clock):
    browser = _a_browser_with_the_legacy_remember_cookie(_legacy_sign_in_id(users, clock))

    clock.move_on(THIRTY_DAYS - A_SECOND)
    assert _signed_in(browser)
    clock.move_on(A_SECOND)
    assert not _signed_in(browser)


@pytest.mark.parametrize("held", ["a-legacy-remember-cookie", "a-legacy-session"])
def test_a_replaced_login_id_ends_a_legacy_sign_in(users, clock, held):
    browser = _a_browser_with_the_legacy_remember_cookie(_legacy_sign_in_id(users, clock))
    assert _signed_in(browser)
    if held == "a-legacy-session":
        # The session the old cookie restored, on its own.
        browser.delete_cookie(LEGACY_REMEMBER_COOKIE)
        assert _signed_in(browser)

    _reset_the_password()

    assert not _signed_in(browser)


@pytest.mark.parametrize("sign_in", [_sign_in, _sign_in_remembered, _sign_in_with_the_code],
                         ids=["unticked", "ticked", "code"])
def test_a_sign_in_deletes_the_legacy_remember_cookie(users, clock, sign_in):
    browser = _a_browser_with_the_legacy_remember_cookie(_legacy_sign_in_id(users, clock))

    response = sign_in(browser)

    assert _deletes(response, LEGACY_REMEMBER_COOKIE)
    assert browser.get_cookie(LEGACY_REMEMBER_COOKIE) is None


def test_signing_out_deletes_the_legacy_remember_cookie(users, clock):
    browser = _a_browser_with_the_legacy_remember_cookie(_legacy_sign_in_id(users, clock))
    assert _signed_in(browser)

    response = _sign_out(browser)

    assert _deletes(response, LEGACY_REMEMBER_COOKIE)
    assert not _signed_in(browser)


def test_a_refused_sign_in_leaves_the_legacy_remember_cookie(users, clock):
    browser = _a_browser_with_the_legacy_remember_cookie(_legacy_sign_in_id(users, clock))

    refused = browser.post("/login", json={"email": FIXTURE_EMAIL, "password": "fixture-wrong-1"})

    assert refused.status_code == 401
    assert _set_cookies(refused, LEGACY_REMEMBER_COOKIE) == []
    assert _signed_in(browser)


def test_a_request_without_the_legacy_cookie_sets_none(client, users):
    response = _sign_in_remembered(client)

    assert _set_cookies(response, LEGACY_REMEMBER_COOKIE) == []


def test_a_remember_cookie_issued_before_the_lengths_is_not_read(users):
    browser = _a_browser_with_the_legacy_remember_cookie("fixture-login-id")
    users.doc["login_id"] = "fixture-login-id"

    # The cookie a sign-in set before sign-ins carried their time: the bare login id.
    assert not _signed_in(browser)


@pytest.mark.parametrize("held", ["a-sign-in", "the-bare-login-id", "the-address"])
def test_a_legacy_session_is_read_only_as_a_sign_in(monkeypatch, client, users, clock, held):
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
    "fixture-secret-never-issued",
])
def test_a_sign_in_of_any_other_shape_loads_no_one(users, clock, held):
    users.doc["login_id"] = "fixture-login-id"

    assert UsersApi.signed_in_account(held) is None


def test_a_record_of_another_account_loads_no_one(users, clock):
    # A record whose account id is not the one its login id names, which no sign-in writes.
    users.doc["login_id"] = "fixture-login-id"
    secret = OrganizerSessions.start("fixture-other-user-id", "fixture-login-id", False)

    assert UsersApi.signed_in_account(secret) is None


# The login id.

@pytest.mark.parametrize("sign_in", [_sign_in, _sign_in_with_the_code], ids=["password", "code"])
def test_an_account_without_a_login_id_gets_one_at_its_first_sign_in_and_keeps_it(users, sign_in):
    assert "login_id" not in users.doc

    sign_in(app_module.app.test_client())
    login_id = users.doc["login_id"]
    _sign_in(app_module.app.test_client())

    assert isinstance(login_id, str) and len(login_id) >= 32
    assert users.doc["login_id"] == login_id


def test_two_first_sign_ins_at_once_agree_on_the_login_id(client, users, organizer_sessions):
    # The other sign-in writes its login id between this one's read and its write.
    users.before_next_update = lambda: users.doc.update(login_id="the-other-sign-in")
    _sign_in(client)

    assert users.doc["login_id"] == "the-other-sign-in"
    assert [kept["login_id"] for kept in organizer_sessions.documents] == ["the-other-sign-in"]
    assert _signed_in(client)
