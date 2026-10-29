---
layer: implementation
kind: data
describes:
  - back-end/placement_history.py
  - back-end/api/markets.py#get_placement_history
verified: 2026-10-29
sources:
  - wayfinding/readable-journey/08
---

# The placement history

The `placement_history` collection: who changed a placement, to what, and when.
[`back-end/placement_history.py`](../../../back-end/placement_history.py) owns it, and every reader and writer goes through it.
A placement that differs from what the solver produced is a fact someone will later ask about, and a flag saying "hand-placed" cannot answer it.

**Placements only.**
Phase transitions, plan edits and form edits are out; a verdict is recorded on the application itself ([the application document](application-document.md)).
A narrow trail that gets read beats a general one that gets ignored.

The glossary concepts: [Assignment](../../business/concepts/assignment.md) and [Placement and pin](../../business/concepts/placement-and-pin.md).

## An entry

Stored snake_case with the market foreign key `market_id`, like applications and unlike markets:

| Field | What it is |
| --- | --- |
| `id` | a UUID |
| `market_id` | the market |
| `actor` | the address of the signed-in organizer who made the change |
| `at` | ISO 8601, UTC |
| `kind` | `placed`, `freed`, `swapped` or `assigned` |
| `vendors` | the lowercased addresses the entry is about, empty for a run |
| `detail` | per kind: the date, table code and table choice placed; the date and table freed; the date and both seats swapped; how many placements a run wrote and how many pins it kept |

**A solver run is one entry**, not none and not one per placement.
Leaving runs out would make the trail lie by omission, since a placement changed between two hand edits would have no explanation; one entry per placement would drown the hand edits, which are the entries anyone reads.
A swap is one entry too, because it was one action.

**Entries are stored structured, never as a sentence**: the wording belongs to the surface showing it, [`front-end/src/utils/placementHistory.ts`](../../../front-end/src/utils/placementHistory.ts), and must be changeable without a migration.

**Writing an entry never fails the change it records.**
The placement writes in `api/placements.py` ([placements](../modules/placements.md)) record after the seat is taken, and `_record` logs and swallows its own failure: telling an organizer their change did not land when it did is worse than a missing entry.

**Recording who** attaches an organizer's identity to a market that may be exported, shared or handed to a successor organizer; that was weighed and accepted when the trail was decided, so do not widen it without revisiting that.

## Reading it

`GET /markets/:id/placement-history` (`get_placement_history` in [`back-end/api/markets.py`](../../../back-end/api/markets.py)) serves a market's trail newest first, at VIEWER: anyone who may see where vendors sit may see how they came to sit there.
`?vendor=` narrows it to the entries naming one person, for their detail panel; a run names nobody, so it is never in a vendor's list.
The answer carries the vendors' names against their addresses, so the trail reads as people.
`market_id` is a [lookup index](lookup-indexes.md).

A market's history is deleted with the market (`delete_for_market`, called by [`back-end/market_deletion.py`](../../../back-end/market_deletion.py)).
The organizer reads it as [the placement history](../../business/flows/placing-by-hand.md#j13-assignment-history).
