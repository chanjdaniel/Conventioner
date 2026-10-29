---
layer: implementation
kind: data
describes:
  - back-end/history.py
  - back-end/api/markets.py#get_placement_history
  - back-end/migrations/migrate_placement_history.py
verified: 2026-10-29
sources:
  - wayfinding/readable-journey/08
  - E40/F01/S01
---

# The market's history

The `history` collection: every change on a market, who made it, and when.
[`back-end/history.py`](../../../back-end/history.py) owns it, and every reader and writer goes through it.
It began as the placement history, because a placement that differs from what the solver produced is a fact someone will later ask about, and a flag saying "hand-placed" cannot answer it.

**Every change, in one history.**
The placement history kept placements only, on the view that a narrow trail that gets read beats a general one that gets ignored.
Daniel widened it (T92, Q23: "yes every change is logged"): an organizer investigating a problem or a mistake asks who did what on the market, whatever it was, and one history answers that where several partial records would each answer part of it.
The decision, and what stays state and what stays apart, is [ADR 0017](../../adr/0017-one-history-for-every-change.md).
Today the placement writes record into it; every other write on a market is to record through the same `record` (E40/F01/S02).

The glossary concepts: [Assignment](../../business/concepts/assignment.md) and [Placement and pin](../../business/concepts/placement-and-pin.md).

## An entry

Stored snake_case with the market foreign key `market_id`, like applications and unlike markets:

| Field | What it is |
| --- | --- |
| `id` | a UUID |
| `market_id` | the market |
| `actor` | the address of the signed-in person who made the change |
| `at` | ISO 8601, UTC |
| `action` | the id of the [E39 action](../modules/market-actions.md) the change was, the verb its check asked: `assign` for a placement |
| `kind` | the finer kind where one action covers several changes, else null: a placement's is `placed`, `freed`, `swapped` or `assigned` |
| `vendors` | the lowercased addresses the entry is about, empty for a run |
| `subject` | what else the entry is about; a placement's is its table-day, `{date, table_codes}`, and a run's is empty |
| `detail` | structured, per kind: the date, table code and table choice placed; the date and table freed; the date and both seats swapped; how many placements a run wrote and how many pins it kept |

`record(market_id, actor, action, kind=, vendors=, subject=, detail=)` writes one; the placement writes call `record_placed`, `record_freed`, `record_swapped` and `record_assignment_run`, which build the detail and its subject (`placement_subject`).
A new kind of change gives its detail the changed fields before and after, never a whole document.

**A run is one entry**, not none and not one per placement.
Leaving runs out would make the history lie by omission, since a placement changed between two hand edits would have no explanation; one entry per placement would drown the hand edits, which are the entries anyone reads.
A swap is one entry too, because it was one action.

**Entries are stored structured, never as a sentence**: the wording belongs to the surface showing it, [`front-end/src/utils/placementHistory.ts`](../../../front-end/src/utils/placementHistory.ts) for the placements, and must be changeable without a migration.

**Writing an entry never fails the change it records.**
The placement writes in `api/placements.py` ([placements](../modules/placements.md)) record after the seat is taken, and `record` logs and swallows its own failure: telling an organizer their change did not land when it did is worse than a missing entry.

**Recording who** attaches an organizer's identity to a market that may be exported, shared or handed to a successor organizer.
That was weighed and accepted for the placements when the trail was decided, and widened to every change on Daniel's word (Q23).

## Reading it

`entries_for_market(market_id, vendor=None)` is a market's whole history newest first; nothing in the product reads it yet (E40/F01/S03 and S04 will).

`GET /markets/:id/placement-history` (`get_placement_history` in [`back-end/api/markets.py`](../../../back-end/api/markets.py)) serves `placement_entries`: the history narrowed to the `assign` action's placement kinds, newest first, each entry with only the fields it had before the widening (`id`, `market_id`, `actor`, `at`, `kind`, `vendors`, `detail`), so the drawer's History tab reads exactly what it always did.
It is read at VIEWER: anyone who may see where vendors sit may see how they came to sit there.
`?vendor=` narrows it to the entries naming one person, for their detail panel; a run names nobody, so it is never in a vendor's list.
The answer carries the vendors' names against their addresses, so the trail reads as people.
`market_id` is a [lookup index](lookup-indexes.md).

A market's history is deleted with the market (`delete_for_market`, called by [`back-end/market_deletion.py`](../../../back-end/market_deletion.py)).
The organizer reads the placements as [the placement history](../../business/flows/placing-by-hand.md#j13-placement-history).

## The move from `placement_history`

Until E40 the entries lived in the `placement_history` collection, without `action` or `subject`.
[`back-end/migrations/migrate_placement_history.py`](../../../back-end/migrations/migrate_placement_history.py) moves each into `history` with every field it had (its `_id` too), adds `action: assign` and the subject read from its detail, and drops the old collection once it is empty.
It writes each entry by its `_id` before deleting it from the old collection, so a second run, or one after a run that stopped part-way, moves only what is left and doubles nothing; `--dry-run` reports the count and writes nothing.
Run it after the release that carries `history.py` is deployed, so the old build writes nothing behind it ([RELEASING.md](../../RELEASING.md#pre-deploy-database-migrations)); until it runs, the History tab shows only the entries written since.
