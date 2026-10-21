---
layer: implementation
kind: data
describes:
  - back-end/utils/email_address.py
  - back-end/datatypes.py#User
  - back-end/api/users.py#ensure_user_indexes
  - back-end/app.py#verify_user_indexes
  - back-end/migrations/migrate_user_emails.py
verified: 2026-10-22
sources:
  - E32/F03/S04
---

# Users, and the one spelling of an address

One document per organizer account in the `users` collection, and the rule every collection follows for a person's address.
[`back-end/api/users.py`](../../../back-end/api/users.py) writes and reads accounts; the model is `User` in [`back-end/datatypes.py`](../../../back-end/datatypes.py).
Vendors have no account: an applicant signs in with a code sent to their address, held per market in `applicant_login_challenges`.

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

The session names the account by its address (`AuthUser.get_id`), and every endpoint loads the account by it (`get_user`); permissions are then decided by the account's id.
The two token fields are [lookup indexes](lookup-indexes.md), so following a link is one indexed read.
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
