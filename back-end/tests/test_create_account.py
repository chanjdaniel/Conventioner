"""An operator creates an organizer account by hand, or verifies one that is stuck.

Sign-up needs the captcha and a delivered verification email; when either is the problem, or an
account is wanted before its owner can click a link, an operator makes it directly. The account
must be the shape sign-up makes, or it is a second kind of user the rest of the app never met.
"""
import uuid

import pytest

from conftest import _update_first, mongo_matches

import account_secrets
import create_account as CreateAccount
from sign_in_secrets import live_verification_link


class _Users:
    """The users collection on the suite's shared matcher and update."""

    def __init__(self, *docs):
        self.docs = [dict(d) for d in docs]

    def find_one(self, query):
        return next((d for d in self.docs if mongo_matches(d, query)), None)

    def insert_one(self, doc):
        self.docs.append(dict(doc))

    def update_one(self, query, update, **_options):
        return _update_first(self.docs, query, update)


def test_an_account_is_made_verified_in_the_shape_sign_up_makes():
    users = _Users()

    CreateAccount.create_account(users, "  Door.Volunteer@Example.com ", "a long passphrase")

    [doc] = users.docs
    assert doc["email"] == "door.volunteer@example.com"
    assert doc["email_verified"] is True
    assert uuid.UUID(doc["id"])
    assert doc["password"] != "a long passphrase"
    assert CreateAccount.bcrypt.check_password_hash(doc["password"], "a long passphrase")
    assert doc["organizations"] == []
    # No sign-in secret is written at all: each lives in ``secrets`` once asked for, and the
    # account is verified, so it is never mailed a verification link.
    assert not {*account_secrets.LEGACY_FIELDS, "secrets"} & set(doc)


def test_an_address_that_already_has_an_account_is_refused():
    users = _Users({"email": "taken@example.com", "email_verified": False})

    with pytest.raises(CreateAccount.AccountError, match="already has an account"):
        CreateAccount.create_account(users, "taken@example.com", "a long passphrase")
    assert len(users.docs) == 1


def test_a_short_password_is_refused_as_sign_up_refuses_it():
    with pytest.raises(CreateAccount.AccountError, match="8 characters"):
        CreateAccount.create_account(_Users(), "new@example.com", "short")


def test_an_account_stuck_unverified_is_verified_and_its_link_ended():
    users = _Users({"email": "stuck@example.com", "email_verified": False,
                    "secrets": {"verify": live_verification_link("fixture-mailed-link")}})

    CreateAccount.verify_account(users, "Stuck@Example.com")

    doc = users.docs[0]
    assert doc["email_verified"] is True
    assert doc["secrets"] == {}


def test_an_account_stuck_with_a_link_mailed_before_the_release_is_verified():
    users = _Users({"email": "stuck@example.com", "email_verified": False,
                    "verification_token": "fixture-mailed-link",
                    "verification_token_expires": "2026-11-13T10:00:00+00:00"})

    CreateAccount.verify_account(users, "stuck@example.com")

    doc = users.docs[0]
    assert doc["email_verified"] is True
    assert not set(account_secrets.LEGACY_FIELDS) & set(doc)


def test_verifying_an_address_with_no_account_says_so():
    with pytest.raises(CreateAccount.AccountError, match="No account"):
        CreateAccount.verify_account(_Users(), "nobody@example.com")
