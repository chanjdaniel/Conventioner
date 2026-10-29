---
layer: implementation
kind: adr
describes:
  - back-end/history.py
  - back-end/migrations/migrate_placement_history.py
verified: 2026-10-29
sources:
  - E40/F01/S01
  - T92
status: accepted
---

# One history for every change

The node it constrains: [the market's history](../implementation/data/history.md).

## Context

A market kept who-did-what in four places, each its own way: the placement history (every placement change and run, structured, worded by the screen), an application's `verdict_by` and `verdict_at` (the latest verdict only), the market's `phaseHistory` ([ADR 0012](0012-a-market-remembers-every-phase-it-entered.md)), and the deletion trail (what an organization's deletion destroyed).
The placement history was scoped to placements on purpose, on the view that a narrow trail that gets read beats a general one that gets ignored.
Asked whether "every change is logged and recorded, who did what" meant permissions only or every change on a market (T92, Q23), Daniel answered "yes every change is logged. should be part of the november work."
An organizer investigating a problem or a mistake asks who did what on the market, whatever it was; four partial records each answer part of that, and the rest went unrecorded.

## Decision

There is one history for every change on a market, and the placement history is it, widened: the `history` collection, owned by [`back-end/history.py`](../../back-end/history.py), the only writer and reader.
Its existing entries are moved into it with every field they had ([`migrate_placement_history.py`](../../back-end/migrations/migrate_placement_history.py)), and the placement trail is the history narrowed to placements.

An entry is the market (or, from E40/F02, the organization), the actor (an organizer's address, or an applicant's when the change is theirs), when, the action, the vendors it is about, a subject for whatever else it is about (an application, a table-day, a question, a setting), and a structured detail with the changed fields before and after.
**The `assign` action's placement kinds are the one exception**: their details keep the shapes they always had (the seat taken, the seat freed, the two seats swapped, a run's counts), with no before, because the entries moved from `placement_history` have none to give and the placement endpoint answers byte for byte as it did; so a hand placement that moves a vendor records where they went, not where they were.
**The action is an [E39 action](../implementation/modules/market-actions.md) id**, the verb the write's check asked, with a finer kind beside it where one action covers several changes, so "may this person take this action" and "this person took this action" share one vocabulary.
The placement history's sharp edges hold for every entry: structured, never a sentence (the wording is the screen's); a run is one entry; writing an entry never fails the change it records; the history is deleted with its market.

What stays where it is:

- **An application's verdict fields and the market's `phaseHistory` stay as state**: the review and the guards read them, and a log is not a state anyone should have to fold. Each of their changes is also to be recorded in the history (E40/F01/S02).
- **The deletion trail stays apart**: it must outlive what it describes, and the history is deleted with its market.

## Consequences

- Every write that changes a market records through `record`, at the place it already asks its E39 action (E40/F01/S02); a later record (permission changes, corrections to a vendor's info, payments, Discord runs) writes here rather than keeping a list of its own.
- Recording who now attaches an organizer's identity to every change on a market, which may be exported, shared or handed to a successor organizer; that was accepted for placements and is widened on Daniel's word.
- The placement endpoint and the drawer's History tab answer as before, by narrowing the history to the `assign` action's placement kinds and to the fields a placement entry always had.
- A database older than the move holds its entries in `placement_history` until the migration runs, so until then the placement trail reads that collection beside `history`: the History tab answers as before from the deploy on, and the release can be rolled back until the migration has run. The migration is idempotent and forward-only, and a later release removes the fallback once every database is moved.

## Considered and rejected

- **A history beside each record** (keep the placement history, add a verdict log, a permissions log, and so on): each answers part of "who did what", the organizer's question needs all of them at once, and every new feature would add another.
- **A new collection beside the placement history**, leaving the placement entries where they were: two stores for one record, and every reader of the market's history would merge them for ever.
- **Free-text entries**: a sentence cannot be filtered, regrouped or reworded without a migration, which is why the placement history never stored one.
- **The history in place of the verdict fields and the phase record**: the guards and the review would fold a log on every read to learn what is true now, and a missing entry would change what the market is.
