---
layer: implementation
kind: adr
describes:
  - back-end/organizer_sessions.py
  - back-end/api/users.py#signed_in_account
  - back-end/api/users.py#_sign_in
  - back-end/app.py#a_legacy_remembered_account
  - back-end/tests/test_the_remember_cookie.py
verified: 2026-11-13
sources:
  - T311
status: accepted
---

# An organizer's sign-in is kept on the server

## Context

An organizer's session and remember-me cookie named the account by a sign-in id, `<login id>.<s|r>.<seconds>`, signed with the app's `SECRET_KEY`, and the server kept nothing of the sign-in itself.
So the server could end a sign-in only by replacing the account's login id, which ends all of them: Sign out cleared the cookies in the browser that pressed it, and a copy of them kept signing in until its 12 hours or 30 days ran out, or until a password reset.
There was no way to end one sign-in on the server, nor to say "sign me out on every device".

## Decision

**Every sign-in is a record on the server, in `organizer_sessions`, and [`back-end/organizer_sessions.py`](../../back-end/organizer_sessions.py) is its only reader and writer.**

- A sign-in, by password or by code, makes a random secret; the browser holds it, in the session and, with "Remember me", in the remember cookie `__Host-organizer_remember`, and the server keeps only its SHA-256, as the record's `_id`, beside the account's id, the login id it signed in under, whether it was remembered, and when it was made and ends.
  So a copy of the database signs nobody in.
- The app's user loader recalls the record by the secret's hash, only while it has not ended and without a write, so use never extends a sign-in, then loads the account by the record's login id.
- Sign out deletes the browser's record, so a copy of its cookies stops working; a new sign-in deletes the record the browser held before, whoever's it was; a password reset replaces the login id in its one write, which ends every sign-in at once, and then deletes the account's records, as deleting the account does.
- A TTL index removes a record once it has ended, and an index by account serves deleting all of an account's; the boot refuses to start without them.
- The remember cookie is Flask-Login's own, renamed, carrying the same secret; its `__Host-` prefix holds it to the API's host, so it is set and deleted `Secure`, at `Path=/` and with no `Domain`.
- For one release the old shapes still sign in, so the deploy signs nobody out: a sign-in id in the session, and the old `remember_token` cookie, which a request loader restores into the session.
  A replaced login id ends them, and every sign-in and sign-out deletes the old cookie; a named follow-up removes both readers.

How the record is read and what ends it are in [users, and the one spelling of an address](../implementation/data/users-and-email.md#a-sign-in-is-kept-on-the-server); the cookies' attributes in [the cookies](../implementation/conventions/security-invariants.md#the-cookies).

## As built

- `start`, `recall`, `end` and `end_all` are the module's four operations, with a `now()` of its own that tests move; `SIGN_IN_LIFETIME` (12 hours) and `REMEMBERED_SIGN_IN_LIFETIME` (30 days) moved there from `api/users.py`.
- In [`api/users.py`](../../back-end/api/users.py), `_sign_in` ends the browser's earlier sign-in, both the one its session names and the one its remember cookie names, then starts one; `signed_in_account` recalls the record, or reads a legacy sign-in id; `logout` ends the browser's sign-in, then clears both cookies; `reset_password` and `delete_user` call `end_all`.
- In [`app.py`](../../back-end/app.py), `a_legacy_remembered_account` is the request loader for the old cookie, and `RefusingLoginManager._clear_cookie` deletes the remember cookie with `Secure`, which Flask-Login's own deletion leaves out and a browser needs to accept the deletion of a `__Host-` cookie.
- The session protection ("strong") is unchanged.
- [`back-end/tests/test_the_remember_cookie.py`](../../back-end/tests/test_the_remember_cookie.py) holds the lifetimes, the cookies' attributes, what ends a sign-in for a copy of the cookies, and the old shapes.

## Consequences

- Each signed-in request reads one document more than before, the record by `_id`.
- A rollback to a release before this one signs out everyone who signed in after it, since that release reads no secret.
- A sign-in made before this release has no record to delete, so until the follow-up only a replaced login id ends it on the server.
