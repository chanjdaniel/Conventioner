---
layer: implementation
kind: data
describes:
  - back-end/lookup_indexes.py
  - back-end/app.py#build_lookup_indexes
verified: 2026-10-30
sources:
  - E32/F03/S04
  - E40/F01/S03
---

# Lookup indexes

**Every field a document is looked up by is indexed at boot, from one list:** `LOOKUP_INDEXES` in [`back-end/lookup_indexes.py`](../../../back-end/lookup_indexes.py), built by `ensure_lookup_indexes()`, which [`back-end/app.py`](../../../back-end/app.py) calls at import (`build_lookup_indexes`) and `init_database.py` calls on a new database.
A new query on a new field belongs there when it is written.

The ids were once indexed only on databases old enough to have run `migrate_to_uuid.py`, so every newer database - every dev stack, CI, and any new deployment - scanned whole collections for its commonest reads.
On a stack holding 25,000 applications, a 314-row import scanned them all twice per row and took 12 seconds.

The glossary concept: [Organization and roles](../../business/concepts/organization-and-roles.md).

## What is indexed

| Collection | Fields, one index each |
| --- | --- |
| `markets` | `id`; `organizationId`; `roles.$**` |
| `organizations` | `id`; `owner`; `admins`; `members` |
| `users` | `id`; `verification_token`; `password_reset_token`; `login_id` (each signed-in request loads the account by it: [users and email](users-and-email.md#the-session-names-the-account-by-its-login-id)) |
| `applications` | `id` |
| `attendance` | `market_id, vendor_email` |
| `history` | `market_id`; `market_id, at, id`, the order its pages are read in ([the market's history](history.md#reading-it)) |
| `vendor_notes` | `market_id, vendor_email` |
| `deletion_trail` | `organization_id` ([market deletion](../modules/market-deletion.md)) |

Market fields are named through `market_doc_key`, so the list holds the stored camelCase spelling ([the market document](market-document.md#key-spelling)).
The three organization indexes serve "the organizations this person is in", an `$or` over `owner`, `admins` and `members`.

**A role is a key of a market's `roles` map**, so "markets this person has a role on" is `{"roles.<user id>": {"$exists": true}}`, served by the wildcard index `roles.$**`.
It used to turn every market's map into an array first, which no index can serve, so every Markets page read every market ([the organization document](organization-document.md#roles-on-a-market)).

## What is not here

These are lookups only, and a database that cannot build one cannot serve a request either, so a failure stops the boot as it is.
Where a collection's correctness rests on a UNIQUE index, the module that relies on it builds that index and refuses to serve without it, because a unique index that will not build is a decision about data:

| Index | Owner | Refusal |
| --- | --- | --- |
| `markets.market_slug`, unique over non-empty slugs | `ensure_market_slug_index` in [`market_documents.py`](../../../back-end/market_documents.py), built by the market migration | the migration markers ([the market document](market-document.md#the-boot-refusal-and-the-migration)) |
| `applications.market_applicant_type_unique` on `market_id, applicant_email, application_type` | `ensure_application_indexes` in [`api/applications.py`](../../../back-end/api/applications.py) | [the application document](application-document.md#indexes) |
| `users.user_email`, unique on `email` | `ensure_user_indexes` in [`api/users.py`](../../../back-end/api/users.py) | [users and email](users-and-email.md#one-address-is-one-account) |
| `applicant_login_challenges`: `market_email_unique` on `market_id, email`, and the TTL index `challenge_ttl` on `expires_at` | `ensure_applicant_login_indexes` in [`api/applicant_auth.py`](../../../back-end/api/applicant_auth.py) | an applicant's sign-in code is one per address per market, and expires by itself |
| `sign_in_attempts`: the TTL index `sign_in_attempt_ttl` on `expires_at` | `ensure_expiry_index` in [`sign_in_limits.py`](../../../back-end/sign_in_limits.py), called by `ensure_applicant_login_indexes` | a sign-in rate-limit counter expires once its window has ended ([sign-in is bounded](../../business/rules/a-vendor-signs-in-before-applying.md#sign-in-is-bounded)) |

The users' email index is deliberately not in `LOOKUP_INDEXES`: `ensure_user_indexes` is its one owner, and replaces a plain index on the same key with the unique one.
An index already present on the same fields is left alone by `ensure_lookup_indexes`, whatever its name or options: databases migrated by `migrate_to_uuid.py` hold unique id indexes under the default names, and asking for a plain one beside them would be refused as a conflict.

Every refusal and its fix is in [Operations](../../OPERATIONS.md#when-the-back-end-refuses-to-boot).
