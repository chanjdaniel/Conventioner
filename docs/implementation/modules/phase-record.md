---
layer: implementation
kind: module
describes:
  - back-end/phase_record.py
  - back-end/datatypes.py#PhaseEntry
verified: 2026-10-21
sources:
  - wayfinding/claims-and-room/06
  - E26/F06/S03
  - bug/8
---

# The phase record

[`back-end/phase_record.py`](../../../back-end/phase_record.py) owns `phaseHistory` on [the market document](../data/market-document.md): one entry for every phase a market entered, and the one answer to "how far did this market get" and "did it run".

## Its interface

| Name | What it is |
| --- | --- |
| `PhaseEntry` ([`back-end/datatypes.py`](../../../back-end/datatypes.py)) | one entry, `{phase, enteredAt, by}`: the phase entered, when, and who moved it there |
| `phase_entry(phase, by)` | a new entry, dated now |
| `push_entries(document, to_phase, by)` | the `$push` that records a move |
| `phases_reached(document, checked_in)` | `PhasesReached`: the phases the market is known to have entered, and `complete`, whether that is the whole story |
| `PhasesReached.ran` | whether it reached `market_days`, the phase that serves a check-in page |

`GET /markets/:id` serves the answer as `phasesReached` and `phaseRecordComplete`.

## Sharp edges

**The record is written in the update that moves the phase.**
`apply_phase_transition`, the one phase writer ([the guards](guards.md)), pushes the entry in the same atomic update that sets the phase, and `create_market` writes the dated `draft` entry every market starts with; whatever a create body carries is replaced.
A move of two steps (a CSV market's Begin Review) is two updates and two entries.

**It is a log, not a "furthest phase" field** ([ADR 0012](../../adr/0012-a-market-remembers-every-phase-it-entered.md)), because the machine has back edges (Reopen for Editing, the form amendment chain) and because a log answers the next questions, when applications opened and who published, which a single field cannot.

**On the market document, not beside it.**
A market enters a handful of phases in its life, the rail reads them on every market screen, and the one market store already holds the document; placements are many and each names a vendor, which is why [the placement history](../data/placement-history.md) is its own collection.

**A market older than the record is read from what it can prove.**
A record whose first entry is not a dated `draft` began partway through the market's life: `push_entries` starts such a record with the phase the market was already in, undated, so it never passes for a whole one.
For such a market `phases_reached` adds what the market holds that proves more (a check-in proves it ran, a stored assignment that it was assigned, a published form that it opened applications) and answers `complete: false`.
Only a complete record may say a market never reached a phase; [the phase rail](phase-rail.md) strikes nothing through without one.

**`checked_in` is a parameter**, so this module reads documents and nothing else: the check-in surface needs its answer, and could not import a module that imported it.

## Why

[The phase rail](phase-rail.md) states what became of an archived market from its furthest phase here; it once read evidence instead, and told a market that ran that no check-in page ever went on the air (bug 8).
[The door](attendance-and-door.md) keeps an archived market's check-in page as a record only if it ran, by the same answer (`ran`) ([an archived market that ran stays a record](../../business/rules/an-archived-market-that-ran-stays-a-record.md)), and deleting an organization says which of its archived markets ran by it too ([when an organization may be deleted](../../business/rules/when-an-organization-may-be-deleted.md)).

The glossary concept it serves: [Phase](../../business/concepts/phase.md).
