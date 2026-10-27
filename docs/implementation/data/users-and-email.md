---
layer: implementation
kind: data
describes:
  - back-end/utils/email_address.py
  - back-end/datatypes.py#User
  - back-end/api/users.py#ensure_user_indexes
  - back-end/api/users.py#AuthUser
  - back-end/api/users.py#get_user_by_login_id
  - back-end/api/users.py#_sign_in
  - back-end/api/users.py#reset_password
  - back-end/app.py#verify_user_indexes
  - back-end/migrations/migrate_user_emails.py
  - back-end/tests/test_the_remember_cookie.py
verified: 2026-10-27
sources:
  - E32/F03/S04
---

# Users, and the one spelling of an address

One document per organizer account in the `users` collection, and the rule every collection follows for a person's address.
[`back-end/api/users.py`](../../../back-end/api/users.py) writes and reads accounts; the model is `User` in [`back-end/datatypes.py`](../../../back-end/datatypes.py).
Vendors have no account: an applicant signs in with a code sent to their address, held per market in `applicant_login_challenges`.

The glossary concept: [Organization and roles](../../business/concepts/organization-and-roles.md).

## The fields that matter

| Field | What it is |
| --- | --- |
| `id` | a UUID, the primary key, and what every role and membership names |
| `email` | the sign-in, stored lowercased and trimmed, unique |
| `password` | a bcrypt hash |
| `organizations` | the ids of the organizations the person is in ([the organization document](organization-document.md)) |
| `email_verified` | false until the emailed link is followed; an unverified account cannot sign in |
| `verification_token`, `verification_token_expires` | the email-verification link, valid an hour |
| `password_reset_token`, `password_reset_token_expires` | the password-reset link, valid an hour |
| `otp`, `otp_expires`, `otp_attempts` | a sign-in code, valid five minutes, cleared by the fifth wrong attempt |
| `login_id` | what the session and the remember-me cookie name the account by: a random value, made at the first sign-in and replaced by a password reset |

## The session names the account by its login id

The session and the remember-me cookie name the account by its `login_id` (`AuthUser.get_id`), not its address, and every request loads the account by it (`get_user_by_login_id`, the app's user loader); `authenticated_email()` then reads the loaded account's address, and permissions are decided by the account's id.
**A password reset replaces the login id**, in the same write as the new password, so every session and remember-me cookie issued before the reset loads no one and that browser is signed out; signing in again works at once.
An organizer who resets a password because a device was lost or shared is signed out on it.
A login id that matches no account loads no one, with no fallback to loading by address: a fallback would keep every remember-me cookie issued before the reset, or before login ids, signing in for its year.
So every organizer signed in once more after the release that brought login ids, whose sessions had named the account by its address.

**Both sign-ins, the password and the code, give an account its login id at its first sign-in** (`_sign_in`): it is written only where none is stored, then read back, so two first sign-ins at once agree on one and neither signs the other out.
The tests are [`back-end/tests/test_the_remember_cookie.py`](../../../back-end/tests/test_the_remember_cookie.py).
A route test that signs in by writing the session with an address points the loader at its own fake account with conftest's `sessions_load_through_get_user`.

## Lookups

`login_id` and the two token fields are [lookup indexes](lookup-indexes.md), so loading the account on each request, and following a link, is one indexed read.
Accounts are made by sign-up, by `back-end/create_account.py` for an operator, and by `create_test_user.py` for the test fixtures; `/register-user` makes an unverified account that cannot sign in.

## One address is one account

**Every address is stored and compared in one form:** `normalized_email()` in [`back-end/utils/email_address.py`](../../../back-end/utils/email_address.py), trimmed and lowercased, empty for none.
Every writer and lookup of an address goes through it: an organizer's account (register, sign-in, a code, a reset, the operator script), an applicant's sign-in and application, a vendor's check-in, the organizer's notes, the table-share answer and the placement trail.
Two spellings of one address used to be two accounts, and an account registered with a capital letter could sign in only spelled exactly so.

**The database is the referee**: `ensure_user_indexes()` builds the unique index `user_email` on `users.email`, and [`app.py`](../../../back-end/app.py) refuses to start without it (`verify_user_indexes`).
Register checks for the address and then inserts, two steps a double click fell between; a losing insert now meets the index and is answered as "User already exists".
The index is unique over the stored form, so before building it the check refuses any account whose address is not stored lowercased, naming the accounts by id and [`migrations/migrate_user_emails.py`](../../../back-end/migrations/migrate_user_emails.py), which rewrites them.
When two accounts would share an address, the migration writes nothing and names them by id: which account is kept is the organizer's call, not a migration's.
Duplicates that stop the index build are named the same way.
Refusals and the migration print ids, never addresses, because they reach an operator's terminal and the host's logs.
Once the unique index stands, the boot check reads nothing more, since a boot on a serverless host is every cold start.
A plain index on `email`, which the lookup indexes once built, is replaced by the unique one; `ensure_user_indexes` is the email index's one owner.
The fix for each refusal is in [Operations](../../OPERATIONS.md#when-the-back-end-refuses-to-boot).

## Deleting an account

A person deletes only their own account, and not while they own an organization: they transfer it first.
Deleting it pulls them from every organization's `admins` and `members`; a role entry naming them on a market stays in that market's `roles`.

What an organizer does with their account, from registering to resetting a password, is [the accounts flows](../../business/flows/accounts.md).
