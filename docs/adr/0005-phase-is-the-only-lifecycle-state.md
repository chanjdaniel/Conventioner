---
layer: implementation
kind: adr
describes:
  - back-end/guards.py#VALID_TRANSITIONS
  - back-end/migrations/migrate_publishing_to_market_days.py
verified: 2026-10-22
sources:
  - wayfinding/v0-1-0/map
  - wayfinding/real-market-readiness/05
  - wayfinding/real-market-readiness/06
  - wayfinding/readable-journey/01
  - E03/F03
  - E10
  - E26/F06/S02
  - E26/F07/S02
status: accepted
---

# The phase is a market's only lifecycle state

The glossary concept: [Phase](../business/concepts/phase.md).

## Context

A market's lifecycle was modelled three times, and the three disagreed.
`isDraft` was a stored flag a request could set, beside `phase`; a market the old build published carried `phase: "draft"` with `isDraft: false`, and nothing could say which was true.
Publishing was the `draft -> archived` transition, fired by the results screen's Done and by a red Archive Market button alike, so `archived` meant both "just gone live" and "over", and the check-in page depended on the one value that could not tell them apart.
`market_days` already existed and meant exactly "running", but the only route to it ran through `assignment -> offers`, deadlocked on statuses nothing writes.
And the setup wizard ended in Assign and Done without moving the phase, so after import, review and Assign a market was still `applications_open`, and Done answered a 400 naming two enum values the organizer had never seen.

## Decision

**`phase` is the single source of truth for a market's lifecycle**, and every other answer about where a market is derives from it.

- `isDraft` is a computed field, true iff `phase == draft`, never writable; it stays persisted only as the fallback for a document whose `phase` is missing or unrecognized ([the market document](../implementation/data/market-document.md#the-phase-and-isdraft)).
- **Publishing is `assignment -> market_days`**: one row in [`VALID_TRANSITIONS`](../../back-end/guards.py), with an entry invariant on `market_days` that an assignment is stored, so no later route can publish an unassigned market.
- **`archived` means one thing: finished.** Every edge into it means "this market is over"; `draft -> archived` is abandoning a draft, never publishing it, and nothing leaves `archived`, nor changes inside it ([an archived market is read-only](../business/rules/an-archived-market-is-read-only.md)).
- A market leaves `draft` for its lifecycle by `draft -> applications_open`, guarded by `FormHasFieldsGuard` and the setup's three.
- The organizer navigates the phase, not a wizard: the plan is one editable page, Assign is an operation inside `assignment` rather than a move, and the moves are on [the phase rail](../implementation/modules/phase-rail.md).

## Consequences

- Each public surface names its own phases rather than "not a draft": check-in serves `market_days`, and an archived market that ran as a record; the applicant surface serves a form market in every phase but `draft`, and applying stays `applications_open`'s.
- **No Mongo condition answers "is this market published?"**, since a legacy draft has no `phase`; the public lookup prunes in Mongo and decides in Python through `phase_from_market_document()`.
- Markets the old build published needed moving: [`migrate_publishing_to_market_days.py`](../../back-end/migrations/migrate_publishing_to_market_days.py) moves those with a stored assignment from `archived` to `market_days`, and `migrate_is_draft_consistency.py` advances a `phase: "draft"`, `isDraft: false` market to `archived` rather than confirm it as a draft.
  Neither has a boot marker: a market left behind fails loudly at its check-in URL, which is not the invisible hazard the marker exists for.
- `offers` stays in the phase set, off the rail's spine, until post-MVP offers are built; nothing reaches it.
- A new lifecycle fact is a phase or a guard in [`guards.py`](../implementation/modules/guards.md), never a flag beside `phase`; a fact the phase cannot hold, such as how vendors reach a market or whether results are published, is its own field with its own writer.
- How far a market got is the [phase record](../implementation/modules/phase-record.md), a log the one phase writer pushes, never a second field.

## Considered and rejected

- **Renaming `archived` to read as "published"**: the lifecycle would still have one value for two opposite states, and the glossary would have to define "publish" as a synonym for "archive".
- **A new "published" phase**: `market_days` already meant it; un-stranding it was one edge, where a new phase meant a new guard table and a migration of the phase vocabulary.
- **The wizard driving the phase**, finishing a step advancing it: the wizard's pages had no order the data needed, and a second model of the lifecycle is what disagreed with the first.

## Superseded

- The first release was to walk the phase machine as it stood, with no new edges (wayfinding/v0-1-0/map).
  Two were added: `applications_open -> draft`, guarded on no application existing, so a form can be corrected before anyone has answered it (wayfinding/real-market-readiness/05), and `assignment -> market_days`, which is publishing (wayfinding/real-market-readiness/06).
- Publishing was to be fired by the results screen's Done; the organizer publishes on the phase rail, and the wizard's Done is gone (wayfinding/readable-journey/01).
- The applicant surface was to narrow to `applications_open` (wayfinding/real-market-readiness/06).
  It serves a form market in every phase but `draft`, so an applicant can always read their application and its outcome; applying itself stays `applications_open`'s (E26/F07/S02).
- Check-in was to serve `market_days` alone; it also serves an archived market that ran, as a record that takes no check-in (E26/F06/S02).
