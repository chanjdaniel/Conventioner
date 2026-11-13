---
layer: implementation
kind: data
describes:
  - back-end/lookup_indexes.py
  - back-end/app.py#build_lookup_indexes
  - back-end/unique_indexes.py
verified: 2026-11-13
sources:
  - E32/F03/S04
  - E40/F01/S03
  - E40/F02/S01
  - E44/F01/S01
  - T204
  - T224
  - T283
  - T270
---

# Lookup indexes

**Every field a document is looked up by is indexed at boot, from one list:** `LOOKUP_INDEXES` in [`back-end/lookup_indexes.py`](../../../back-end/lookup_indexes.py), built by `ensure_lookup_indexes()`, which [`back-end/app.py`](../../../back-end/app.py) calls at import (`build_lookup_indexes`) and `init_database.py` calls on a new database.
A new query on a new field belongs there when it is written.

The ids were once indexed only on databases old enough to have run `migrate_to_uuid.py`, so every newer database - every dev stack, CI, and any new deployment - scanned whole collections for its commonest reads.
On a stack holding 25,000 applications, a 314-row import scanned them all twice per row and took 12 seconds.

The glossary concept: [Organization and roles](../../business/concepts/organization-and-roles.md).

## What is indexed

| Collection       | Fields, one index each                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `markets`        | `id`; `organizationId`; `roles.$**`                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `organizations`  | `id`; `people.$**`; `owner`; `admins`; `members`                                                                                                                                                                                                                                                                                                                                                                                                           |
| `users`          | `id`; `verification_token`; `password_reset_token`; `login_id` (each signed-in request loads the account by it: [users and email](users-and-email.md#the-session-names-the-account-by-its-login-id))                                                                                                                                                                                                                                                       |
| `applications`   | `id`; `market_id, arriving`, the applications waiting to be dealt as they arrived, read while a deal holds the market by `arriving` being an object (`$type: object`), which the index bounds tightly where `$exists` cannot, since a regular index stores a missing field as null ([ADR 0020](../../adr/0020-an-application-is-dealt-to-one-reviewer.md))                                                                                                 |
| `history`        | `market_id`; `market_id, at, id`, the order its pages are read in ([the market's history](history.md#reading-it)); `organization_id, at, id`, an organization's own history, read and deleted by it ([what an organization records](history.md#what-an-organization-records)); `id`, an entry written once under its id, a market Delete's `delete-market` entry upserted under its deletion's trail id ([market deletion](../modules/market-deletion.md)) |
| `vendor_notes`   | `market_id, vendor_email`                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `payments`       | `market_id, vendor_email` ([payments](payments.md))                                                                                                                                                                                                                                                                                                                                                                                                        |
| `deletion_trail` | `organization_id` ([market deletion](../modules/market-deletion.md))                                                                                                                                                                                                                                                                                                                                                                                       |

Market fields are named through `market_doc_key`, so the list holds the stored camelCase spelling ([the market document](market-document.md#key-spelling)).
"The organizations this person is in" is `organization_people.of_person`'s `$or`: the person's key in the organization's `people` map, `{"people.<user id>": {"$exists": true}}`, served by the wildcard index `people.$**`, and, on an organization stored before the map, its `owner`, `admins` or `members`, each indexed so the query can use all of them ([one map of people](organization-document.md#one-map-of-people)).
The three list indexes go with the lists, a release after the map (T283's follow-up).
The users' `id` index serves one account read alone and many read at once: `get_users_by_ids` reads every account a read names with one `$in` over it ([users and email](users-and-email.md#lookups)).

**A role is a key of a market's `roles` map**, so "markets this person has a role on" is `{"roles.<user id>": {"$exists": true}}`, served by the wildcard index `roles.$**`.
It used to turn every market's map into an array first, which no index can serve, so every Markets page read every market ([the organization document](organization-document.md#roles-on-a-market)).

## What is not here

These are lookups only, and a database that cannot build one cannot serve a request either, so a failure stops the boot as it is.
Where a collection's correctness rests on a UNIQUE index, the module that relies on it builds that index and refuses to serve without it, because a unique index that will not build is a decision about data:

| Index                                                                                                                        | Owner                                                                                                                                     | Refusal                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `markets.market_slug`, unique over non-empty slugs                                                                           | `ensure_market_slug_index` in [`market_documents.py`](../../../back-end/market_documents.py), built by the market migration               | the migration markers ([the market document](market-document.md#the-boot-refusal-and-the-migration))                                                                |
| `applications.market_applicant_type_unique` on `market_id, applicant_email, application_type`                                | `ensure_application_indexes` in [`api/applications.py`](../../../back-end/api/applications.py)                                            | [the application document](application-document.md#indexes)                                                                                                         |
| `users.user_email`, unique on `email`                                                                                        | `ensure_user_indexes` in [`api/users.py`](../../../back-end/api/users.py)                                                                 | [users and email](users-and-email.md#one-address-is-one-account)                                                                                                    |
| `applicant_login_challenges`: `market_email_unique` on `market_id, email`, and the TTL index `challenge_ttl` on `expires_at` | `ensure_applicant_login_indexes` in [`api/applicant_auth.py`](../../../back-end/api/applicant_auth.py)                                    | an applicant's sign-in code is one per address per market, and expires by itself                                                                                    |
| `sign_in_attempts`: the TTL index `sign_in_attempt_ttl` on `expires_at`                                                      | `ensure_expiry_index` in [`sign_in_limits.py`](../../../back-end/sign_in_limits.py), called by `ensure_applicant_login_indexes`           | a sign-in rate-limit counter expires once its window has ended ([sign-in is bounded](../../business/rules/a-vendor-signs-in-before-applying.md#sign-in-is-bounded)) |
| `vendor_remembered_sign_ins`: the TTL index `remembered_sign_in_ttl` on `expires_at`                                         | `ensure_expiry_index` in [`remembered_sign_ins.py`](../../../back-end/remembered_sign_ins.py), called by `ensure_applicant_login_indexes` | a vendor's remembered sign-in is removed once it has ended ([the cookies](../conventions/security-invariants.md#the-cookies))                                       |
| `attendance.attendance_vendor_day_unique` on `market_id, vendor_email, date`                                                 | `ensure_attendance_indexes` in [`api/attendance.py`](../../../back-end/api/attendance.py), through `unique_indexes`                       | [attendance and the door](../modules/attendance-and-door.md#one-vendors-day-is-one-record-by-the-database)                                                          |
| `amounts_owed.amounts_owed_vendor_day_unique` on `market_id, vendor_email, date`                                             | `ensure_payment_indexes` in [`payments.py`](../../../back-end/payments.py), through `unique_indexes`                                      | [payments](payments.md#one-vendors-day-is-one-owed-record-by-the-database)                                                                                          |
| `payments.payments_request_key_unique` on `market_id, request_key`, partial to string keys                                   | `ensure_payment_indexes` in [`payments.py`](../../../back-end/payments.py), through `unique_indexes`                                      | [payments](payments.md#a-payment-is-recorded-once-per-press)                                                                                                        |

**A new unique index is built through [`back-end/unique_indexes.py`](../../../back-end/unique_indexes.py)** (T270), beside the owners above, which stay as they are.
`ensure_unique_index` returns at once when an index of its name stands unique, since a boot on the serverless host is every cold start; otherwise it builds it, and on any `PyMongoError` raises `UniqueIndexError`, naming the duplicates that `duplicate_groups` finds by one aggregation over the records the index covers (its partial filter, when it has one): by the fields an operator may read and each record's `_id`, never by an address, and Mongo's error by its type and code only, with no cause kept.
Its caller in `app.py` logs "Refusing to start: ..." and re-raises, as `verify_user_indexes` does.
`VENDOR_DAY_INDEXES` lists each collection kept one record per vendor's day, which [`migrations/check_vendor_day_duplicates.py`](../../../back-end/migrations/check_vendor_day_duplicates.py) reads before a release is promoted ([RELEASING.md](../../RELEASING.md#pre-deploy-database-migrations)).

The users' email index is deliberately not in `LOOKUP_INDEXES`: `ensure_user_indexes` is its one owner, and replaces a plain index on the same key with the unique one.
Nor is a lookup on `attendance` or `amounts_owed`: each unique index's prefix `market_id, vendor_email` serves a vendor's records and a market's.
An index already present on the same fields is left alone by `ensure_lookup_indexes`, whatever its name or options: databases migrated by `migrate_to_uuid.py` hold unique id indexes under the default names, and asking for a plain one beside them would be refused as a conflict.

Every refusal and its fix is in [Operations](../../OPERATIONS.md#when-the-back-end-refuses-to-boot).
