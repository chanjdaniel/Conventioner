---
layer: implementation
kind: module
describes:
  - back-end/market_deletion.py
  - back-end/deletion_trail.py
  - back-end/tombstone.py
  - back-end/api/markets.py#delete_market
  - back-end/api/markets.py#_organization_is_deleting
  - back-end/api/markets.py#create_market
  - back-end/app.py#delete_market
  - back-end/app.py#import_applications
  - back-end/api/applicants.py#save_applicant_application
  - back-end/api/applicants.py#_gone_under_the_save
  - back-end/api/added_vendors.py#add_vendor
  - front-end/e2e/market-records-go-with-it.spec.ts
  - back-end/history.py#delete_for_market
  - back-end/history.py#record_for_organization
  - back-end/services/gridfs_service.py#delete_images_for_market
  - back-end/tests/test_a_deleted_market_takes_its_floorplan_images.py
  - back-end/tests/test_every_read_of_a_target_asks_for_a_live_one.py
  - back-end/tests/real_mongo/test_a_deletion_leaves_a_tombstone.py
verified: 2026-11-13
sources:
  - E20/F04/S01
  - bug/47
  - E40/F01/S01
  - E40/F02/S01
  - E44/F01/S01
  - T263
  - T277
  - T307
---

# Market deletion, and the deletion trail

[`back-end/market_deletion.py`](../../../back-end/market_deletion.py) deletes a market and every record kept beside it; [`back-end/deletion_trail.py`](../../../back-end/deletion_trail.py) records what an organization's deletion destroyed, before it destroys it; [`back-end/tombstone.py`](../../../back-end/tombstone.py) is the state a market or an organization is in while it is being deleted.

## Its interface

| Name                                                                         | What it does                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mark_deleting(markets, document, tombstone, holding_phase=False)`           | sets the tombstone on the market by one write held on its being live, and on its stored phase as read when `holding_phase`; answers the tombstone it carries now, this one or one another deletion set first, or None when it is gone or its phase moved |
| `delete_records(market_id)`                                                  | deletes the market's applications, check-ins, applicant sign-in codes and remembered sign-ins, history, vendor notes, its vendors' payments and amounts owed, and its floorplan images; each step deletes what is there, so it may run again             |
| `delete_market_and_records(markets, market_id)`                              | `delete_records`, then the market; returns the market's `DeleteResult`                                                                                                                                                                                   |
| `kept_only_while_live(markets, market_id)`                                   | after a request's last write beside a market: when `deletion_decided`, deletes its records again and raises `MarketGoneUnderWrite`, a 404 "Market not found"                                                                                             |
| `deletion_decided(markets, market_id)`                                       | whether the market is gone, or carries a tombstone nothing takes back: its own Delete's, or its organization's once that deletion's trail entry is written                                                                                               |
| `organization_taken(organization_id)`                                        | whether the organization is gone, or its deletion's trail entry is written, after which it deletes the organization's history and takes no tombstone back                                                                                                |
| `record_organization_deletion(organization, markets, actor_email, trail_id)` | writes one `organization_deleted` entry to `deletion_trail` under the trail id, its `_id` too, so a second write of it adds nothing; raises rather than swallow any other failure                                                                        |
| `is_recorded(trail_id)`                                                      | whether a deletion's entry is written                                                                                                                                                                                                                    |
| `entries_for_organization(org_id)`                                           | every entry naming an organization; read-only, and nothing removes one; no caller yet                                                                                                                                                                    |
| `live(query)`, `tombstone_of(document)`, `new_tombstone(by)`                 | in `tombstone.py`: a filter narrowed to live targets, the tombstone a stored document carries, and a new one with a trail id of its own                                                                                                                  |

## The tombstone

A deletion is many writes: the records, collection by collection, then the document.
With no state of its own, a target stayed live until the last of them, so a deletion cut halfway and retried judged again what it had half destroyed, and a write landing in between went on to a target that was going.
So a deletion first sets `deleting: {at, by, trail_id}` on its target, by one conditional write, and only then destroys anything:

```
live --delete--> deleting --each step--> deleting --last step--> gone
deleting --retry--> deleting (resumed, with its trail id)
```

The key is the same on a market and an organization document, and an absent key reads as live, so no stored document needed a migration ([the market document](../data/market-document.md#being-deleted), [the organization document](../data/organization-document.md)).

**A target being deleted reads as absent.**
Every request's read of a market or an organization passes its filter through `live`: the market loaders (`load_market_context`, `_load_market_and_organization_for`, the Markets list, the public lookup by slug that the vendor page, applying and the check-in go through) and the organization reads (`get_organization`, a person's organizations, the organization's own pages).
So a market being deleted answers 404 to its owner, to its vendors and on its vendor page, and leaves the Markets list, and an organization being deleted leaves its people's lists.

**Nothing writes to one.**
Every write to a market or an organization document holds it live: `write_market` does for every judged market write and answers a market being deleted as `MarketNotFoundError` ([the market write](market-write.md)); the dealing lease's writes and the essential offering's freeze hold it in their own filters; the organization's rename, its default table and every people write hold it and answer 404 when it matched nothing.
[`back-end/tests/test_every_read_of_a_target_asks_for_a_live_one.py`](../../../back-end/tests/test_every_read_of_a_target_asks_for_a_live_one.py) walks the back end by AST, as the market write's guard does, and fails any call with a filter on either collection that does not pass it through `live` (written in the call, or as a name the same function assigned from it), unless its site is listed with a permanent reason: the deletions themselves, which read their target whatever its state; the refused write's second read; the unique address and name checks, since a target being deleted still holds its address and its name until it is gone; the reads of `deletion_decided` and `organization_taken`, which ask whether a deletion is decided; a deal letting go of its lease; a deleted account leaving every organization; the boot checks, the seeder, and the migrations.
A call on a receiver the walk cannot name is not judged: `market_by_slug` in [`back-end/market_documents.py`](../../../back-end/market_documents.py) asks for a live market all the same, and `market_id_at_slug` does not, since it only names a cookie the browser holds, so that it can be cleared.

**A record written beside a market as it is deleted is taken back.**
A request that read its market live before the tombstone can write after the deletion swept: the application an applicant's save or an import creates, its answers, its history.
The applicant's save (`save_applicant_application` in [`back-end/api/applicants.py`](../../../back-end/api/applicants.py), through `_gone_under_the_save`), the import route (`import_applications` in [`back-end/app.py`](../../../back-end/app.py)) and an added vendor (`add_vendor` in [`back-end/api/added_vendors.py`](../../../back-end/api/added_vendors.py)) call `kept_only_while_live` after their last write: seeing the market live, they came before the tombstone, so the sweep comes after every write they made; seeing it gone, or going by a deletion now certain, they delete its records again and answer 404.
**A tombstone its organization's deletion may still take back leaves the records alone**: that deletion takes every tombstone back when its second judgment finds a market under way, so a sweep then would empty a market that lives on.
`deletion_decided` reads the market, then the deletion trail, then the organization, then the market again: a tombstone is certain once its trail id's entry is written, or when the market carries it and its organization does not, which is a market's own Delete, since an organization's deletion takes its markets' tombstones back before its own.
An organization's tombstone with no trail entry yet leaves the request to answer as it would have: if that deletion goes on, it sweeps only after writing its trail, after this read, so it takes what the request wrote.
The other writes beside a market (a check-in, a payment, a note, a history entry after a judged write) are refused by their loaders once the tombstone stands, and are not checked again after their write: a request already past its read when the tombstone lands can leave its one record.

**A market created into an organization that began its deletion is taken back.**
`create_market` adds the new market to its organization's `markets` by a write held on the organization being live; when that matches nothing, the organization's deletion may already have listed its markets, so the new market is deleted again and the creation answers 404 "Organization not found", rather than leave a market belonging to nothing.

**A cut deletion is finished by sending it again.**
Both delete dialogs keep Delete pressable after a failure, and the retry reads its target whatever its state, finds the tombstone and goes on.
Nothing else finishes one: a deletion cut and never retried leaves its target tombstoned, absent to everyone, with its records, until an operator finishes it by running the same deletion ([a deletion that was cut](../../OPERATIONS.md#a-deletion-that-was-cut)).

## Sharp edges

**A market's records go with it, by either door** (bug 47).
A market is deleted by its own Delete (`DELETE /markets/:id`, [`delete_market`](../../../back-end/app.py) and its namesake in [`back-end/api/markets.py`](../../../back-end/api/markets.py), the market owner's alone, in any phase) or by its organization's deletion; both delete through `delete_records`.
Deleting the market document alone once left every vendor's name, email and answers behind for ever, describing a market nobody could reach.
**A new collection keyed by `market_id` belongs here**: one line in one place, rather than a third door that forgets it.
A record keyed by the market another way belongs here too, as the floorplan images are, by their metadata.

| Record                                    | Collection                                                                                               | Deleted by                                                                                                                                                          |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| applications                              | `applications`                                                                                           | `delete_applications_for_market` ([the application document](../data/application-document.md))                                                                      |
| check-ins                                 | `attendance`                                                                                             | `delete_attendance_for_market` ([attendance and the door](attendance-and-door.md))                                                                                  |
| applicant sign-in codes                   | `applicant_login_challenges`                                                                             | `delete_challenges_for_market` ([a vendor signs in before applying](../../business/rules/a-vendor-signs-in-before-applying.md))                                     |
| vendors' remembered sign-ins              | `vendor_remembered_sign_ins`                                                                             | `delete_for_market` in `back-end/remembered_sign_ins.py` ([the cookies](../conventions/security-invariants.md#the-cookies))                                         |
| its history, the placement trail among it | `history`                                                                                                | `delete_for_market` in [`back-end/history.py`](../../../back-end/history.py) ([the market's history](../data/history.md))                                           |
| the organizer's vendor notes              | `vendor_notes`                                                                                           | `delete_for_market` in `back-end/vendor_notes.py`                                                                                                                   |
| its vendors' payments and amounts owed    | `payments`, `amounts_owed`                                                                               | `delete_for_market` in `back-end/payments.py` ([payments](../data/payments.md))                                                                                     |
| its floorplan images                      | the GridFS bucket `floorplan_images`: each file naming the market in `metadata.marketId`, and its chunks | `delete_images_for_market` in [`back-end/services/gridfs_service.py`](../../../back-end/services/gridfs_service.py) ([a location's layout](floorplan-placement.md)) |

**A market's own Delete: its tombstone, its records, then it.**
`delete_market` reads the market whatever its state and asks the owner's right on it; a market whose organization carries a tombstone reads as absent here (`_organization_is_deleting`), since that deletion owns it.
A live market gets its tombstone (`mark_deleting`, held on its being live alone, since a Delete keeps no rule of the phase); one already deleting keeps its own.
Then it is pulled from its organization's `markets`, its records go, its organization's history records that it went, and the market document goes last.
**That entry is written under the deletion's trail id** (`record_for_organization`'s `entry_id`, an upsert that only sets on insert), before the market goes, so a retry of a Delete cut at any step records `delete-market` once: its name, who deleted it and when ([what an organization records](../data/history.md#what-an-organization-records)).
The upsert is keyed on `_id`, which the database holds unique, so two Delete requests of the same market overlapping in time (a double press, or a retry while the first is still running) still leave one entry.
A Delete that read its organization live can meet that organization's deletion, which takes the market as going already, deletes the organization's history and the organization; so after writing the entry it asks `organization_taken`, and when the organization is gone or its deletion decided, deletes the organization's history again, rather than leave an entry nothing reaches.

**The deletion trail stays apart from the market's history** ([ADR 0017](../../adr/0017-one-history-for-every-change.md)): the history is deleted with its market, and the trail must outlive what it describes.
A market deleted on its own writes no trail entry; its organization's history records that it went.

**The trail is written BEFORE anything is destroyed, and once.**
Its write is allowed to fail the whole operation: an organization deleted with no record of what went with it is the thing the trail exists for.
An organization's deletion writes it after every tombstone of its own is set and judged, and under its trail id, so a retry that finds the entry written has nothing left to decide, and a retry cut before it writes it then ([when an organization may be deleted](../../business/rules/when-an-organization-may-be-deleted.md)).
Each entry names the organization, the person and the time, and describes each market as it stood (its name, phase, whether it ran, its placements and the public address it kept), never by id alone, since an id that points at nothing records nothing.
Entries outlive everything they describe: there is nothing left to delete them with.
A market's own Delete writes none, and its confirmation names the public pages that stop working instead.
The collection is indexed on `organization_id` ([lookup indexes](../data/lookup-indexes.md)); nothing in the product reads it yet (`entries_for_organization` has no caller), so an operator reads it in the database.

## Why

- [When an organization may be deleted](../../business/rules/when-an-organization-may-be-deleted.md): the drafts and archived markets go, through here, after the trail.
- [An archived market that ran stays a record](../../business/rules/an-archived-market-that-ran-stays-a-record.md): deleting one takes a live vendor page and the record of a market that happened, which is why the trail describes what it took.

`front-end/e2e/market-records-go-with-it.spec.ts` ([spec](../../../front-end/e2e/market-records-go-with-it.spec.ts)) deletes a market by each door and finds none of its applications, check-ins, sign-in codes, remembered sign-ins, history, payments, amounts owed or floorplan images (file and chunk) left; `back-end/tests/test_vendor_notes.py` does the same for the notes, [`back-end/tests/test_a_deleted_market_takes_its_floorplan_images.py`](../../../back-end/tests/test_a_deleted_market_takes_its_floorplan_images.py) for two images, leaving another market's, and `back-end/tests/test_organization_deletion.py` for the trail's order, a cut organization deletion resumed, a market moved after the preview and a record taken back.
[`back-end/tests/real_mongo/test_a_deletion_leaves_a_tombstone.py`](../../../back-end/tests/real_mongo/test_a_deletion_leaves_a_tombstone.py) runs each on a real server ([the real-MongoDB suite](../testing/real-mongo-suite.md)): an organization's deletion and a market's own Delete cut at each step and sent again, leaving one trail entry, one `delete-market` entry and nothing behind; a draft entering review after the preview, refused; an applicant's save and an import landing after the deletion, refused with nothing left; an applicant's save meeting the deletion after its rules, its history entry or its deal, a refused save, and an added vendor, each answering 404 with nothing left; a write beside a draft whose tombstone the refused deletion takes back, keeping every record; a market created between the tombstones and the second judgment, taken with the others; a market's own Delete meeting its organization's whole deletion, leaving no history entry behind; a write landing after its market was swept by an organization's deletion that has written its trail, taken back; a market's own Delete writing its entry after that trail, leaving none; a market and an organization being deleted read as absent, and a market created as its organization began deleting, taken back.

A market's own Delete, as its owner meets it, is [L5](../../business/flows/ending-and-managing-a-market.md#l5-delete-a-market).

The glossary concepts it serves: [Market](../../business/concepts/market.md) and [Organization and roles](../../business/concepts/organization-and-roles.md).
