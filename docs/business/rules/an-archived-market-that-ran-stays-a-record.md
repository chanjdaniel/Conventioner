---
layer: business
kind: rule
describes:
  - back-end/api/attendance.py#get_check_in_market
  - back-end/api/attendance.py#market_has_ended
  - front-end/e2e/an-archive-keeps-its-check-in-page.spec.ts
verified: 2026-10-21
sources:
  - E26/F06/S02
  - E26/F06/S03
  - E03/F03
  - bug/9
---

# An archived market that ran stays a record

An archived market that ran keeps its public check-in page, as a record: it shows each vendor's seats and check-ins, marked as ended, and takes no check-in.
An archived market that never ran has no public page.

**Serves:** [The door on market day](../intents/the-door-on-market-day.md).

## Why

A market that happened leaves vendors and organizers who may need to look up where someone sat and when they arrived.
Archiving once took the check-in page off the air, against the docs and the organization deletion preview, which both said an archived market was still served (bug 9).
Whether a market ran is a fact a phase cannot hold, since `archived` follows a market that ran and a draft abandoned alike; the [phase record](../../implementation/modules/phase-record.md) says it (E26/F06/S03, [ADR 0012](../../adr/0012-a-market-remembers-every-phase-it-entered.md)), and placements are no proof, since a market can be assigned and archived without ever being published.

**So deleting an archived market that ran takes a live URL off the air and destroys the record of a market that happened.**
Both doors that delete one say so before it is done: deleting its organization names, per market, whether it ran and the address that stops resolving, and records the deletion in the trail first ([when an organization may be deleted](when-an-organization-may-be-deleted.md)); the market's own Delete names the check-in page that stops working.

## Where it is kept

- `get_check_in_market` in [`back-end/api/attendance.py`](../../../back-end/api/attendance.py) serves a running market, or an archived one whose phase record says it ran; `market_has_ended` marks the page `ended`.
  A check-in or undo there answers 409, "This market has ended, so check-in is closed."; an address with no market answers 404 ([attendance and the door](../../implementation/modules/attendance-and-door.md)).
- The record is read-only like the rest of an archived market ([an archived market is read-only](an-archived-market-is-read-only.md)).
- A market the old build published reads as archived until it is migrated, so its page is a record, served only once someone has checked in there ([the market document](../../implementation/data/market-document.md#parsing-a-stored-market)).
- Deleting it goes through [market deletion](../../implementation/modules/market-deletion.md), which takes its check-ins with it.
- [`front-end/e2e/an-archive-keeps-its-check-in-page.spec.ts`](../../../front-end/e2e/an-archive-keeps-its-check-in-page.spec.ts) pins it.
