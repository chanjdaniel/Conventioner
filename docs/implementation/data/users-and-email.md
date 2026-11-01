---
layer: implementation
kind: data
describes:
  - back-end/utils/email_address.py
  - back-end/datatypes.py#User
  - back-end/api/users.py#ensure_user_indexes
  - back-end/api/users.py#AuthUser
  - back-end/api/users.py#register_user
  - back-end/api/users.py#register_user_with_captcha
  - back-end/api/users.py#get_user_by_login_id
  - back-end/api/users.py#signed_in_account
  - back-end/api/users.py#_sign_in
  - back-end/api/users.py#reset_password
  - back-end/app.py#verify_user_indexes
  - back-end/migrations/migrate_user_emails.py
  - back-end/tests/test_the_remember_cookie.py
verified: 2026-11-01
sources:
  - E32/F03/S04
  - T85
  - E38/F14/S01
  - T169
  - E38/F14/S02
  - T176
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
| `organizations` | the ids of the organizations the person is in ([the organization document](organization-document.md)); empty at registration, whatever the body sends, and written only by a membership change |
| `email_verified` | false until the emailed link is followed; an unverified account cannot sign in |
| `verification_token`, `verification_token_expires` | the email-verification link, valid an hour |
| `password_reset_token`, `password_reset_token_expires` | the password-reset link, valid an hour |
| `otp`, `otp_expires`, `otp_attempts` | a sign-in code, valid five minutes, cleared by the fifth wrong attempt |
| `login_id` | the account a session or remember-me cookie names, in its sign-in id: a random value, made at the first sign-in and replaced by a password reset |

## The session names the account by its login id

The session and the remember-me cookie name the account by its `login_id`, not its address, inside a sign-in id (`AuthUser.get_id`): `<login id>.<s|r>.<seconds since the epoch>`, the kind saying whether "Remember me" was ticked and the time when the account signed in.
Each signed-in request reads it through the app's user loader, `signed_in_account`, which refuses a sign-in as old as its kind's length ([the cookies](../conventions/security-invariants.md#the-cookies)) and an id of any other shape, then loads the account by its login id (`get_user_by_login_id`); `authenticated_email()` then reads the loaded account's address, and permissions are decided by the account's id.
**A password reset replaces the login id**, in the same write as the new password, so every session and remember-me cookie issued before the reset loads no one and that browser is signed out; signing in again works at once.
An organizer who resets a password because a device was lost or shared is signed out on it.
A login id that matches no account loads no one, with no fallback to loading by address: a fallback would keep every remember-me cookie issued before the reset, or before login ids, signing in.
So every organizer must sign in once more after the release that brings login ids, since their sessions had named the account by its address, and once more after the release that brings sign-in ids, since theirs had named the bare login id.

**Both sign-ins, the password and the code, give an account its login id at its first sign-in** (`_sign_in`): it is written only where none is stored, then read back, so two first sign-ins at once agree on one and neither signs the other out.
A read-back that finds none is the server's fault, logged and answered 500, never a refused sign-in.

Both read the body's `remember` with `flag_field`, so only JSON `true` is "Remember me" ([a request value is a string](../conventions/a-request-value-is-a-string.md#the-one-spelling)).
The tests are [`back-end/tests/test_the_remember_cookie.py`](../../../back-end/tests/test_the_remember_cookie.py).
A route test that signs in by writing the session with an address points the user loader at its own fake account with conftest's `sessions_load_through_get_user`.

**A refused sign-in says what to do next, in three named sentences in `users.py`** (E38/F14/S02, [the sign-in's messages](../../business/flows/accounts.md#a2-sign-in-and-sign-out)).
`SIGN_IN_DOES_NOT_MATCH` answers a wrong password and an address with no account alike, the same status and body, and the password is checked either way: against one stand-in hash, made once at the app's cost factor, when the address has no account (`_password_matches`).
`SIGN_IN_VERIFY_FIRST` answers a right password, a right code or a code asked for on an account not yet verified.
`SIGN_IN_WRONG_CODE` answers a wrong code and a code for an address with no account alike for each of the first four tries; an account's fifth wrong code discards its code and answers 429 "Too many wrong codes. Ask for a new one.", which an address with no account, having no count, never answers, until the sign-in limits count every address alike (E47/F02/S01).
[`back-end/tests/test_the_sign_in_answers.py`](../../../back-end/tests/test_the_sign_in_answers.py) holds each, and that none says "log in".

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
