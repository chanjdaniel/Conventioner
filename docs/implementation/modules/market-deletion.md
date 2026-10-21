---
layer: implementation
kind: module
describes:
  - back-end/market_deletion.py
  - back-end/deletion_trail.py
  - back-end/api/markets.py#delete_market
  - back-end/app.py#delete_market
  - front-end/e2e/market-records-go-with-it.spec.ts
verified: 2026-10-22
sources:
  - E20/F04/S01
  - bug/47
---

# Market deletion, and the deletion trail

[`back-end/market_deletion.py`](../../../back-end/market_deletion.py) deletes a market and every record kept beside it; [`back-end/deletion_trail.py`](../../../back-end/deletion_trail.py) records what an organization's deletion destroyed, before it destroys it.

## Its interface

| Name | What it does |
| --- | --- |
| `delete_market_and_records(markets, market_id)` | deletes the market's applications, check-ins, applicant sign-in codes, placement trail and vendor notes, then the market; returns the market's `DeleteResult` |
| `record_organization_deletion(organization, markets, actor_email)` | writes one `organization_deleted` entry to `deletion_trail`, and raises rather than swallow a failure |
| `entries_for_organization(org_id)` | every entry naming an organization; read-only, and nothing removes one; no caller yet |

## Sharp edges

**A market's records go with it, by either door** (bug 47).
A market is deleted by its own Delete (`DELETE /markets/:id`, [`delete_market`](../../../back-end/app.py) and its namesake in [`back-end/api/markets.py`](../../../back-end/api/markets.py), the market owner's alone, in any phase, which also pulls it from its organization's `markets`) or by its organization's deletion; both call `delete_market_and_records`.
Deleting the market document alone once left every vendor's name, email and answers behind for ever, describing a market nobody could reach.
**A new collection keyed by `market_id` belongs here**: one line in one place, rather than a third door that forgets it.

| Record | Collection | Deleted by |
| --- | --- | --- |
| applications | `applications` | `delete_applications_for_market` ([the application document](../data/application-document.md)) |
| check-ins | `attendance` | `delete_attendance_for_market` ([attendance and the door](attendance-and-door.md)) |
| applicant sign-in codes | `applicant_login_challenges` | `delete_challenges_for_market` ([a vendor signs in before applying](../../business/rules/a-vendor-signs-in-before-applying.md)) |
| the placement trail | `placement_history` | `delete_for_market` ([the placement history](../data/placement-history.md)) |
| the organizer's vendor notes | `vendor_notes` | `delete_for_market` in `back-end/vendor_notes.py` |

**The records go first and the market last**, so a failure part-way leaves the market there to delete again, rather than records that nothing reaches.

**The trail is written BEFORE anything is destroyed, and is allowed to fail the whole operation**: an organization deleted with no record of what went with it is the thing the trail exists for.
Each entry names the organization, the person and the time, and describes each market as it stood (its name, phase, whether it ran, its placements and the public address it kept), never by id alone, since an id that points at nothing records nothing.
Entries outlive everything they describe: there is nothing left to delete them with.
Only an organization's deletion writes one; a market's own Delete writes none, and its confirmation names the public pages that stop working instead.
The collection is indexed on `organization_id` ([lookup indexes](../data/lookup-indexes.md)); nothing in the product reads it yet (`entries_for_organization` has no caller), so an operator reads it in the database.

## Why

- [When an organization may be deleted](../../business/rules/when-an-organization-may-be-deleted.md): the drafts and archived markets go, through here, after the trail.
- [An archived market that ran stays a record](../../business/rules/an-archived-market-that-ran-stays-a-record.md): deleting one takes a live check-in page and the record of a market that happened, which is why the trail describes what it took.

`front-end/e2e/market-records-go-with-it.spec.ts` ([spec](../../../front-end/e2e/market-records-go-with-it.spec.ts)) deletes a market by each door and finds none of its applications, check-ins, sign-in codes or trail left; `back-end/tests/test_vendor_notes.py` does the same for the notes, and `back-end/tests/test_organization_deletion.py` for the trail's order.

A market's own Delete, as its owner meets it, is [L5](../../business/flows/ending-and-managing-a-market.md#l5-delete-a-market).

The glossary concepts it serves: [Market](../../business/concepts/market.md) and [Organization and roles](../../business/concepts/organization-and-roles.md).
