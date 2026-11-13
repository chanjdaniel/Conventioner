"""An organizer's sign-ins kept on a real server (ADR 0027): signing out ends one, so a copy of the
browser's cookies is refused, and a password reset ends every one of the account's."""
import hashlib

import pytest

ORGANIZER = "fixture-sessions-organizer@example.com"
REMEMBER_COOKIE = "__Host-organizer_remember"


def _copied(client):
    import app as app_module

    copy_of = app_module.app.test_client()
    for name in ("session", REMEMBER_COOKIE):
        kept = client.get_cookie(name)
        if kept is not None:
            copy_of.set_cookie(name, kept.value)
    return copy_of


def _signed_in(client):
    return client.get("/check-session").status_code == 200


def _secret_of(client):
    with client.session_transaction() as held:
        return held["_user_id"]


@pytest.fixture
def remembered(boot_indexes, signed_in):
    """A browser signed in with "Remember me", and a copy of its cookies."""
    browser = signed_in(ORGANIZER)
    response = browser.post("/login", json={"email": ORGANIZER, "password": "fixture-password-1",
                                            "remember": True})
    assert response.status_code == 200
    return browser, _copied(browser)


def test_a_sign_in_is_kept_by_the_hash_of_the_browsers_secret(remembered, organizer_sessions):
    browser, _copy = remembered

    [kept] = organizer_sessions.find({})
    assert kept["_id"] == hashlib.sha256(_secret_of(browser).encode()).hexdigest()
    assert kept["user_id"] == browser.account_id
    assert kept["remembered"] is True


def test_signing_out_ends_it_for_a_copy_of_the_cookies(remembered, organizer_sessions):
    browser, copy_of = remembered
    assert _signed_in(copy_of)

    assert browser.post("/logout").status_code == 200

    assert organizer_sessions.count_documents({}) == 0
    assert not _signed_in(copy_of)
    assert not _signed_in(browser)


def test_a_password_reset_ends_every_sign_in_of_the_account(
        remembered, organizer_sessions, monkeypatch):
    import api.users as UsersApi
    import app as app_module

    browser, copy_of = remembered
    mailed = []
    monkeypatch.setattr(UsersApi, "send_password_reset_email",
                        lambda _to, link: mailed.append(link) or True)
    asked = app_module.app.test_client().post("/request-password-reset", json={"email": ORGANIZER})
    assert asked.status_code == 200

    reset = app_module.app.test_client().post(
        "/reset-password", json={"token": mailed[0], "new_password": "fixture-password-2"})

    assert reset.status_code == 200
    assert organizer_sessions.count_documents({"user_id": browser.account_id}) == 0
    assert not _signed_in(copy_of)
    assert not _signed_in(browser)
