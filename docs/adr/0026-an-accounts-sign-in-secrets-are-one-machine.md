---
layer: implementation
kind: adr
describes:
  - back-end/account_secrets.py
  - back-end/tests/test_the_sign_in_secret_machine.py
  - back-end/tests/test_one_writer_of_the_sign_in_secrets.py
verified: 2026-11-13
sources:
  - T311
status: accepted
---

# An account's sign-in secrets are one machine

## Context

An organizer's account holds three secrets a mail carries: a sign-in code, a reset link and a verification link.
Each was kept in the database as it was mailed, in ten loose fields (`otp`, `otp_expires`, `otp_attempts`, and a token and an expiry for each link), and each route read them and wrote them in its own way.
So their states mixed in ways nobody chose: two requests for a code at once could both find no wait and mail two codes, of which only the later signed in; a refused mail put back what the account held before, by a write of its own.
And a copy of the database held every live code and link as it was mailed.

## Decision

**Each kind of secret is one record under the account's `secrets` field, and [`back-end/account_secrets.py`](../../back-end/account_secrets.py) is the only code that reads or writes them.**

- A record is `{hash, expires_at, next_allowed_at, tries, state}`; `state` is `sending`, `live`, `used` or `discarded`, and an absent record is "none".
- What is stored is a hash, never the secret: a code salted, as the vendor's code is, so a copy of the database holds nothing that signs an account in.
- Every change is one write conditional on the state it moves from, so two requests at once meet in the filter and one of them wins.
  The module's table of (state, event) is the whole of what may happen, and a test, [`back-end/tests/test_the_sign_in_secret_machine.py`](../../back-end/tests/test_the_sign_in_secret_machine.py), holds every cell of it.
- A secret is issued as `sending` before it is mailed; the provider's answer makes it `live` with its wait, or unsets it, so a mail the provider refused leaves no wait and no live secret, and nothing earlier is written back.
- Every function takes the users collection from `api/users.py`, so there is one handle to the collection, and reads the time from the module's own `now()`.
- A source scan, [`back-end/tests/test_one_writer_of_the_sign_in_secrets.py`](../../back-end/tests/test_one_writer_of_the_sign_in_secrets.py), fails when any other back-end module names the field, a path under it or a legacy field.
- For one release the legacy fields are still read: the first time the module reads an account holding them it turns them into records in one conditional write and unsets them, so a secret mailed before the deploy keeps working until it would have expired; a named follow-up deletes that upgrade and the fields.

The kinds, their life and their waits, and the table, are in [users, and the one spelling of an address](../implementation/data/users-and-email.md#the-sign-in-secrets).

## As built

- The sign-in code is the module's first kind, `secrets.code`: `/request-otp` issues it, `/login-otp` counts a try in the write that finds it, and the legacy `otp`, `otp_expires` and `otp_attempts` are upgraded on first read.
- The reset link and the verification link still live in their legacy fields, written by `api/users.py`, until they join the module as its `reset` and `verify` kinds.

## Consequences

- A code request costs one write before the mail and one after it; the code sign-in costs one more read for the release, the read that finds legacy fields.
- A state no row of the table names cannot be written, so a later change to how a secret lives is a change to the table and its test.
- An E2E spec cannot read a secret out of MongoDB: it plants one it knows, as the mail would carry it (`front-end/e2e/helpers/accountSecrets.ts`).
