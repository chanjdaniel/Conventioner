"""An organizer's sign-in code and reset link each hold one state on a real server, with requests
on real threads.

Every guarantee rests on a write conditional on the state it moves from (``account_secrets``): the
hermetic suite proves the table through fakes; these run the losing branch where it lives. Each
request goes through the route on a test client of its own.
"""
import pytest

import account_secrets
import api.users as UsersApi
from real_mongo import harness
from real_mongo.conftest import FIXTURE_PASSWORD

ORGANIZER = "racing-organizer@example.com"


@pytest.fixture
def account(boot_indexes, sign_in_attempts):
    from create_account import create_account

    return create_account(UsersApi.users_collection, ORGANIZER, FIXTURE_PASSWORD)


@pytest.fixture
def mailed(monkeypatch):
    """Every code mailed, in order; each send is taken by the provider."""
    codes = []

    def send(to, code):
        codes.append((to, code))
        return True

    monkeypatch.setattr(UsersApi, "send_otp_email", send)
    return codes


def _clients(n):
    import app as app_module

    return [app_module.app.test_client() for _ in range(n)]


def _stored_code():
    account = UsersApi.users_collection.find_one({"email": ORGANIZER})
    return (account.get("secrets") or {}).get("code")


def test_five_code_requests_at_once_mail_one_code_and_it_is_the_stored_one(
        account, mailed, race):
    clients = _clients(5)
    harness.warm(UsersApi.users_collection, 5)

    answered = race(5, lambda i: clients[i].post("/request-otp", json={"email": ORGANIZER}))

    assert sorted(answer.status_code for answer in answered) == [200, 429, 429, 429, 429]
    assert all(answer.get_json()["msg"].startswith("You can ask for a new code in")
               for answer in answered if answer.status_code == 429)
    assert len(mailed) == 1
    code = _stored_code()
    assert code["state"] == account_secrets.LIVE
    assert account_secrets.code_matches(code["hash"], mailed[0][1])


def test_five_right_codes_at_once_sign_in_once(account, mailed, race):
    [asked] = _clients(1)
    assert asked.post("/request-otp", json={"email": ORGANIZER}).status_code == 200
    [(_to, code)] = mailed
    clients = _clients(5)
    harness.warm(UsersApi.users_collection, 5)

    answered = race(5, lambda i: clients[i].post(
        "/login-otp", json={"email": ORGANIZER, "otp": code}))

    assert sorted(answer.status_code for answer in answered) == [200, 401, 401, 401, 401]
    stored = _stored_code()
    assert (stored["state"], stored["next_allowed_at"]) == (account_secrets.USED, None)


@pytest.fixture
def mailed_links(monkeypatch):
    """Every reset link mailed, in order; each send is taken by the provider."""
    links = []

    def send(to, link):
        links.append((to, link))
        return True

    monkeypatch.setattr(UsersApi, "send_password_reset_email", send)
    return links


def test_five_uses_of_one_reset_link_at_once_reset_once(account, mailed_links, race):
    import app as app_module

    [asked] = _clients(1)
    assert asked.post("/request-password-reset", json={"email": ORGANIZER}).status_code == 200
    [(_to, link)] = mailed_links
    passwords = [f"fixture-racing-password-{i}" for i in range(5)]
    clients = _clients(5)
    harness.warm(UsersApi.users_collection, 5)

    answered = race(5, lambda i: clients[i].post(
        "/reset-password", json={"token": link, "new_password": passwords[i]}))

    assert sorted((answer.status_code, answer.get_json()["msg"]) for answer in answered) == [
        (200, "Password reset successfully"), *[(400, "Invalid reset token")] * 4]
    [reset_to] = [password for password, answer in zip(passwords, answered)
                  if answer.status_code == 200]
    stored = UsersApi.users_collection.find_one({"email": ORGANIZER})
    assert app_module.bcrypt.check_password_hash(stored["password"], reset_to)
    assert (stored["secrets"]["reset"]["state"], stored["email_verified"]) == (
        account_secrets.USED, True)
