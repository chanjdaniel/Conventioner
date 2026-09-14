"""Deleting an account is something only its owner's session can do.

The vulnerability this pins was proven by request on 2026-09-14 (E07/F01/S01): ``POST /delete-user``
carried no ``@login_required`` and decided ownership by comparing the ``X-Owner-Email`` header to the
email in the request body. Both are attacker-controlled, so the equality always held and a bare
``curl`` with no session deleted a verified account.

The rule these tests hold is the epic's, stated once: **a request can only do what the authenticated
session is allowed to do.** Identity never comes from something the caller sends.

The owner-of-an-organization case is here too, because the old handler deleted such a user anyway and
returned a warning - stranding every market in that organization behind an owner who no longer exists.
"""
import os
import sys
from types import SimpleNamespace

import pytest

from conftest import skip_without_real_dependencies

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

skip_without_real_dependencies()

import app as app_module
import api.users as UsersApi
import api.organizations as OrgsApi


VICTIM = "victim@example.com"
ATTACKER = "attacker@example.com"


class FakeUsersCollection:
    def __init__(self, docs):
        self.docs = {doc["email"]: dict(doc) for doc in docs}

    def find_one(self, query):
        doc = self.docs.get(query.get("email"))
        return dict(doc) if doc else None

    def delete_one(self, query):
        removed = self.docs.pop(query.get("email"), None)
        return SimpleNamespace(deleted_count=1 if removed else 0)


class FakeOrganizationsCollection:
    def __init__(self, docs=()):
        self.docs = [dict(doc) for doc in docs]
        self.updates = []

    def find(self, query):
        owner = query.get("owner")
        return [dict(doc) for doc in self.docs if doc.get("owner") == owner]

    def update_many(self, query, update):
        self.updates.append((query, update))
        return SimpleNamespace(modified_count=0)


def _user(email, verified=True, user_id=None):
    return {
        "email": email,
        "id": user_id or f"id-{email}",
        "email_verified": verified,
        "organizations": [],
    }


@pytest.fixture
def users(monkeypatch):
    def _install(*docs):
        collection = FakeUsersCollection(docs)
        monkeypatch.setattr(UsersApi, "users_collection", collection)
        return collection
    return _install


@pytest.fixture
def organizations(monkeypatch):
    def _install(*docs):
        collection = FakeOrganizationsCollection(docs)
        monkeypatch.setattr(OrgsApi, "organizations_collection", collection)
        return collection
    return _install


@pytest.fixture
def client(monkeypatch, organizations):
    """A real client with login ENABLED - the point of these tests.

    Session protection is relaxed because these assert authorization, not session hardening;
    ``strong`` would log the test session out over a user-agent hash it has no reason to care about.
    """
    organizations()
    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    monkeypatch.setattr(
        UsersApi, "get_user",
        lambda email: SimpleNamespace(
            id=f"id-{email}", email=email, is_active=True, is_authenticated=True,
            is_anonymous=False, get_id=lambda: email,
        ),
    )
    return app_module.app.test_client()


def _signed_in_as(client, email):
    with client.session_transaction() as session:
        session["_user_id"] = email
        session["_fresh"] = True


def _delete(client, email_in_body, header_email=None):
    headers = {"X-Owner-Email": header_email} if header_email else {}
    return client.post("/delete-user", json={"email": email_in_body}, headers=headers)


class TestNoSession:
    """The proven attack, and the anonymous path it rode in on."""

    def test_the_proven_attack_is_refused(self, client, users):
        """No cookie; header and body both name a verified victim."""
        collection = users(_user(VICTIM))

        response = _delete(client, VICTIM, header_email=VICTIM)

        assert response.status_code == 401
        assert VICTIM in collection.docs

    def test_an_unverified_account_cannot_be_deleted_anonymously_either(self, client, users):
        """The cleanup path was the hole's cover. An anonymous caller gets nothing."""
        collection = users(_user(VICTIM, verified=False))

        response = _delete(client, VICTIM, header_email=VICTIM)

        assert response.status_code == 401
        assert VICTIM in collection.docs

    def test_a_request_with_no_header_at_all_is_refused(self, client, users):
        collection = users(_user(VICTIM))

        response = _delete(client, VICTIM)

        assert response.status_code == 401
        assert VICTIM in collection.docs


class TestSignedInAsSomeoneElse:
    """``@login_required`` proves you are *some* user. It must not let you be *any* user."""

    def test_a_spoofed_header_does_not_make_the_victim_the_caller(self, client, users):
        collection = users(_user(VICTIM), _user(ATTACKER))
        _signed_in_as(client, ATTACKER)

        response = _delete(client, VICTIM, header_email=VICTIM)

        assert response.status_code == 403
        assert VICTIM in collection.docs

    def test_an_unverified_account_is_not_a_free_target(self, client, users):
        collection = users(_user(VICTIM, verified=False), _user(ATTACKER))
        _signed_in_as(client, ATTACKER)

        response = _delete(client, VICTIM, header_email=VICTIM)

        assert response.status_code == 403
        assert VICTIM in collection.docs

    def test_the_header_cannot_redirect_the_deletion_away_from_the_session(self, client, users):
        """Body names the attacker, header names the victim: neither spelling helps."""
        collection = users(_user(VICTIM), _user(ATTACKER))
        _signed_in_as(client, ATTACKER)

        _delete(client, ATTACKER, header_email=VICTIM)

        assert VICTIM in collection.docs


class TestSignedInAsYourself:
    def test_you_can_delete_your_own_account(self, client, users):
        collection = users(_user(ATTACKER))
        _signed_in_as(client, ATTACKER)

        response = _delete(client, ATTACKER)

        assert response.status_code == 200
        assert ATTACKER not in collection.docs

    def test_a_spoofed_header_is_ignored_rather_than_obeyed(self, client, users):
        """The header is not an authorization input any more, so it changes nothing."""
        collection = users(_user(ATTACKER), _user(VICTIM))
        _signed_in_as(client, ATTACKER)

        response = _delete(client, ATTACKER, header_email=VICTIM)

        assert response.status_code == 200
        assert ATTACKER not in collection.docs
        assert VICTIM in collection.docs

    def test_deleting_an_account_that_does_not_exist_is_not_found(self, client, users):
        users(_user(ATTACKER))
        _signed_in_as(client, ATTACKER)

        response = _delete(client, "ghost@example.com")

        assert response.status_code in (403, 404)


class TestOwningAnOrganization:
    """Deleting an owner used to succeed with a warning, stranding the organization."""

    def test_an_owner_cannot_delete_their_account_while_they_own_one(
        self, client, users, organizations, monkeypatch
    ):
        collection = users(_user(ATTACKER, user_id="id-owner"))
        organizations({"id": "org-1", "name": "Seed Test Org", "owner": "id-owner"})
        _signed_in_as(client, ATTACKER)

        response = _delete(client, ATTACKER)

        assert response.status_code == 409
        assert ATTACKER in collection.docs, "the account must survive a refused deletion"

    def test_the_refusal_names_the_organizations_so_it_is_actionable(
        self, client, users, organizations
    ):
        users(_user(ATTACKER, user_id="id-owner"))
        organizations({"id": "org-1", "name": "Seed Test Org", "owner": "id-owner"})
        _signed_in_as(client, ATTACKER)

        response = _delete(client, ATTACKER)

        assert "Seed Test Org" in response.get_json().get("ownedOrganizations", [])

    def test_a_member_who_owns_nothing_can_still_delete(self, client, users, organizations):
        collection = users(_user(ATTACKER, user_id="id-member"))
        organizations({"id": "org-1", "name": "Seed Test Org", "owner": "id-someone-else"})
        _signed_in_as(client, ATTACKER)

        response = _delete(client, ATTACKER)

        assert response.status_code == 200
        assert ATTACKER not in collection.docs
