#!/usr/bin/env python3
"""Create an organizer account by hand, or verify one stuck unverified. For operators.

Sign-up needs the captcha and a delivered verification email. When either is the problem, or an
account is wanted before its owner can click a link, an operator makes it here, in the shape
sign-up makes (``api.users.register_user_with_captcha``), already verified. Access to an
organization or a market is then granted in the product, by its owner (see docs/OPERATIONS.md).

Run from ``back-end/`` against the database the environment names - for production, put the URI
on the command line, never in ``back-end/.env``:

    MONGODB_URI='mongodb+srv://...' .venv/bin/python create_account.py create someone@example.com
    MONGODB_URI='mongodb+srv://...' .venv/bin/python create_account.py verify someone@example.com

The password is asked for, never taken as an argument: an argument lands in shell history.
``create_test_user.py`` is the test fixtures' script, which prints the password it was given.
"""
import argparse
import getpass
import sys
import uuid
from typing import Any

from flask_bcrypt import Bcrypt

bcrypt = Bcrypt()

MIN_PASSWORD_LENGTH = 8


class AccountError(Exception):
    """Why the account was not made or changed, in words for the operator."""


def _address(email: str) -> str:
    # Login matches the stored address exactly, so an account made with capitals would be one
    # its owner cannot sign in to by typing their address the way everyone else does.
    address = (email or "").strip().lower()
    if "@" not in address or "." not in address.split("@")[-1]:
        raise AccountError(f"{email!r} is not an email address.")
    return address


def create_account(users: Any, email: str, password: str) -> str:
    """Insert a verified account for ``email``. Returns its id."""
    address = _address(email)
    if len(password) < MIN_PASSWORD_LENGTH:
        raise AccountError(f"The password must be at least {MIN_PASSWORD_LENGTH} characters.")
    if users.find_one({"email": address}):
        raise AccountError(
            f"{address} already has an account. If it is unverified, run `verify` instead."
        )
    account_id = str(uuid.uuid4())
    users.insert_one({
        "id": account_id,
        "email": address,
        "password": bcrypt.generate_password_hash(password).decode("utf-8"),
        "organizations": [],
        "email_verified": True,
        "verification_token": None,
        "verification_token_expires": None,
        "password_reset_token": None,
        "password_reset_token_expires": None,
        "otp": None,
        "otp_expires": None,
        "otp_attempts": 0,
    })
    return account_id


def verify_account(users: Any, email: str) -> None:
    """Mark an existing account verified, as clicking its verification link would."""
    address = _address(email)
    if not users.find_one({"email": address}):
        raise AccountError(f"No account for {address}.")
    users.update_one({"email": address}, {"$set": {
        "email_verified": True,
        "verification_token": None,
        "verification_token_expires": None,
    }})


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("action", choices=["create", "verify"])
    parser.add_argument("email")
    args = parser.parse_args(argv)

    from db_config import get_database
    users = get_database()["users"]
    try:
        if args.action == "create":
            password = getpass.getpass("Password (8+ characters): ")
            if getpass.getpass("Again: ") != password:
                raise AccountError("The two passwords differ.")
            account_id = create_account(users, args.email, password)
            print(f"Created a verified account for {_address(args.email)} (id {account_id}).")
        else:
            verify_account(users, args.email)
            print(f"{_address(args.email)} is verified.")
    except AccountError as e:
        print(f"Not done: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
