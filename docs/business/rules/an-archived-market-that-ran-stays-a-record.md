---
layer: business
kind: rule
describes:
  - back-end/api/attendance.py#ended_after_it_ran
  - back-end/api/attendance.py#market_has_ended
  - back-end/api/attendance.py#_closed_since
  - front-end/src/components/vendorPage/VendorCheckIn.vue
  - front-end/e2e/an-archive-keeps-its-vendor-page.spec.ts
verified: 2026-11-04
sources:
  - E26/F06/S02
  - E26/F06/S03
  - E03/F03
  - bug/9
  - T202
  - T318
---

# An archived market that ran stays a record

An archived market that ran keeps its vendor page, as a record: each vendor, signed in, reads where they sat on each day and when they checked in, under "This market has ended.", and the page takes no check-in ([ADR 0022](../../adr/0022-the-vendor-page-is-signed-in.md)).
An archived market that never ran keeps no record of check-ins; a form market's vendor page stays, showing each vendor their application and the outcome as published, if it was.

**Serves:** [The door on market day](../intents/the-door-on-market-day.md).

## Why

A market that happened leaves vendors and organizers who may need to look up where someone sat and when they arrived.
Archiving once took the market's public check-in page off the air, against the docs and the organization deletion preview, which both said an archived market was still served (bug 9).
That page was public, so anyone could read any vendor's seats there; the record is each vendor's own now, behind their sign-in (T202).
Whether a market ran is a fact a phase cannot hold, since `archived` follows a market that ran and a draft abandoned alike; the [phase record](../../implementation/modules/phase-record.md) says it (E26/F06/S03, [ADR 0012](../../adr/0012-a-market-remembers-every-phase-it-entered.md)), and placements are no proof, since a market can be assigned and archived without ever being published.

**So deleting an archived market that ran takes a live URL off the air and destroys the record of a market that happened.**
Both doors that delete one say so before it is done: deleting its organization names, per market, whether it ran and the address that stops resolving, and records the deletion in the trail first ([when an organization may be deleted](when-an-organization-may-be-deleted.md)); the market's own Delete names the vendor page that stops working.

## Where it is kept

- `ended_after_it_ran` in [`back-end/api/attendance.py`](../../../back-end/api/attendance.py) marks the vendor page's read `ended`: archived (`market_has_ended`), and its phase record says it ran.
  A vendor's check-in there answers 409, "This market has ended, so check-in is closed." ([attendance and the door](../../implementation/modules/attendance-and-door.md)).
- A check-in or its undo sent as the market is archived changes nothing either: each reads the phase again after its write and takes the write back on a market no longer in its days, so the record of who came is the one the archive closed ([attendance and the door](../../implementation/modules/attendance-and-door.md#sharp-edges), T318).
- [`VendorCheckIn.vue`](../../../front-end/src/components/vendorPage/VendorCheckIn.vue) shows the record, "Where you sat": each seat, and "Checked in at <time>" or "Not checked in".
- The record is read-only like the rest of an archived market ([an archived market is read-only](an-archived-market-is-read-only.md)).
- A market the old build published reads as archived until it is migrated, so it reads as a record that ran only once someone has checked in there ([the market document](../../implementation/data/market-document.md#parsing-a-stored-market)).
- Deleting it goes through [market deletion](../../implementation/modules/market-deletion.md), which takes its check-ins with it.
- [`front-end/e2e/an-archive-keeps-its-vendor-page.spec.ts`](../../../front-end/e2e/an-archive-keeps-its-vendor-page.spec.ts) pins it.
