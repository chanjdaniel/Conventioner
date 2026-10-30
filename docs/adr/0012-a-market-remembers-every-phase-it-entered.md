---
layer: implementation
kind: adr
describes:
  - back-end/phase_record.py#push_entries
  - back-end/phase_record.py#phases_reached
verified: 2026-10-29
sources:
  - wayfinding/claims-and-room/06
  - E26/F06/S03
  - bug/8
status: accepted
---

# A market remembers every phase it entered

The glossary concept: [Phase](../business/concepts/phase.md).

## Context

A market held its current phase and nothing of the phases before it.
Whatever had to say how far a market got read evidence instead: a stored assignment meant it was assigned, a published form that it opened applications.
No evidence told "assigned, then archived" from "assigned, published, ran, then archived", so the archived rail always stopped at Assignment and said the stronger thing anyway: that no check-in page ever went on the air, about a market whose check-in page had served a real market day (bug 8).
The phase machine has back edges, so evidence is also lost: a market that opened applications and went back to draft lost its form's published stamp, its only proof, and was then told it "was abandoned before it ran".
Two things needed "did this market run?" straight away: an archived market's Attendance tab and its public check-in page.

## Decision

Every market carries a log of the phases it entered, `phaseHistory` on the market document, each entry `{phase, enteredAt, by}`.
The one phase writer, `apply_phase_transition`, pushes the entry in the same atomic update that moves the phase, and `create_market` writes the dated `draft` entry every market starts with, so no mover can record differently (the form amendment's chain, which also moved phases, is gone since ADR 0016).
[`back-end/phase_record.py`](../../back-end/phase_record.py) is the one answer to how far a market got and whether it ran, served on the market as `phasesReached` and `phaseRecordComplete` ([the phase record](../implementation/modules/phase-record.md)).
A market older than the record is read from what it can prove (a check-in proves it ran, a stored assignment that it was assigned, a published form that it opened applications), and its answer is marked incomplete; only a complete record may say a market never reached a phase.

## Consequences

- The record reaches every market screen through [the one market store](0009-the-back-end-is-the-only-source-of-truth.md) with nothing new to fetch, and it also says when applications opened and who published.
- A market moved before the record existed can never say more than its evidence; the phase rail then states what is proven and strikes nothing through ([the phase rail](../implementation/modules/phase-rail.md)).
- Whatever asks "did it run?" asks `phases_reached(...).ran`: the archived rail, the check-in page kept as a record ([an archived market that ran stays a record](../business/rules/an-archived-market-that-ran-stays-a-record.md)), and an organization's deletion preview ([when an organization may be deleted](../business/rules/when-an-organization-may-be-deleted.md)).
- A second writer of the phase that skipped the push would make the record lie by omission, which is why there is one writer.

## Considered and rejected

- **One "furthest phase" field**: the back edges make "furthest" ambiguous, and a single field cannot answer when applications opened or who published.
- **A collection beside the market, as the placement history is**: placements are many and each names a vendor; a market enters a handful of phases, and every market screen would have to fetch them separately.
- **Reading the evidence, as before**: it is what failed (bug 8), and a back edge destroys it.
- **Backfilling older markets with a guessed history**: a guess would let an incomplete record claim a market never reached a phase, the one claim the record exists to make safely.
