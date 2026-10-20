---
id: E32/F03/S04
title: The doubled verification email
type: story
status: done
blocked_by: []
pr: [#109]
---

## What to build

On 2026-10-18 one address was sent two "Verify your email address" emails 150 ms apart, which looks like a signup submitted twice.
Reproduce it first, as a person signing up would hit it (a double click, Enter then click).
If it reproduces: the signup control is disabled while its request is in flight, and the server ignores a repeat signup for the same address within a few seconds, sending one email.
If it does not reproduce, close this story as `wontfix` with what was tried.

## Reproduced 2026-10-19

A double click on Register made **two accounts** for one address in 2 of 3 runs, each sent a verification email (`a-signup-is-sent-once.spec.ts`).
The form had no in-flight guard, and register checked for the address and then inserted it, with nothing in the database forbidding a second document: `users.email` was indexed but not unique.
Register also stored the address as typed while every other writer lowercased it.

## As built (settled with Daniel: a unique index and a migration)

- The signup is guarded while in flight.
- `users.email` is UNIQUE over the lowercased address, built at boot (`api.users.ensure_user_indexes`); the back end refuses to start while an address is stored with capitals or two accounts share one, naming them by id. A concurrent duplicate insert answers "User already exists" and sends nothing.
- Every lookup and write of an address goes through `utils/email_address.normalized_email`, the one spelling of any person's address (check-in, notes, table share and the placement trail used their own copies).
- Decision 31 said to ignore a repeat within a few seconds. A repeat is refused instead ("User already exists"), since the index is what can tell; with the button guarded, a person signing up does not see it.
- Boot reads no account once the index stands, since every cold start on the host is a boot.
- `migrations/migrate_user_emails.py` lowercases stored addresses, and stops and names accounts that would collide. It must run against production before this release is promoted (`docs/RELEASING.md`).

## Acceptance criteria

- [x] The reproduction is recorded in this story, either way.
- [x] If fixed: a double click and an Enter-then-click each send one verification email.
- [x] Two registrations racing at the server for one address, in any case, make one account.
