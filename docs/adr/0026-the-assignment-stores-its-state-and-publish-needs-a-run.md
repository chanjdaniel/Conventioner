---
layer: implementation
kind: adr
describes:
  - back-end/assignment/lifecycle.py
  - back-end/migrations/migrate_assignment_state.py
verified: 2026-11-14
sources:
  - T277
  - T316
status: accepted
---

# The assignment stores its state, and Publish results needs a run

## Context

An organizer in the Assignment phase could assign one vendor to a table by hand, press Publish results, and publish the market with no table allocation ever run.
Every other approved vendor then read "You did not get assigned" on their vendor page, though nobody had decided that: the solver never ran.

The product could not tell this apart from a real allocation, because nothing stored where the assignment stood.
Its state was read off five fields (the rows, their hand-placed flags, `madeFrom`, `resultsPublished` and the phase), and eight functions on two sides each re-derived it with their own precedence.
Publish results asked only for rows and nothing changed since the run, which an assignment of pins alone passed; the go-live guard said "the solver has actually placed someone" and read only rows.
The suite could not see it either: its "run" was unflagged rows with no `madeFrom`, a run the product cannot make.
The front end kept its own copy of where a run may happen, by the phase alone, while the server also read the published flag, so the rule had two copies that already disagreed.

## Decision

**The assignment stores its state, and one module owns it: [`back-end/assignment/lifecycle.py`](../../back-end/assignment/lifecycle.py).**

- `assignmentObject.state` is `none`, `pinned` or `run`, written with the rows by the owner's one write, `store`.
- `madeFrom` is required on `run`; an allocation stored before runs recorded it carries a legacy marker that holds no group, so it reads as current, as it did.
- Publish results stores the assignment revision it stood on, `assignmentObject.publishedRevision`, so a change by hand after results can be told from the results applicants read.
- The owner serves one value on the market read, `allocation`: `none`, `pinned`, `current`, `stale`, `published` or `changed_since_published`.
  Every refusal that reads the assignment asks it, and the screens read it instead of working it out from the phase.
- Publish results and going live are refused until a table allocation has been run and is current; on pins alone the refusal says allocating keeps them.
- **The read trusts the stored state only while it agrees with the stored rows and `madeFrom`**, and otherwise reads the state those give, by the same rule the migration writes, logging the disagreement by market id.
  A release rolled back to does not write the state, and may leave one its rows contradict; Publish results must read such a market correctly before the migration is run again.
- A migration, [`back-end/migrations/migrate_assignment_state.py`](../../back-end/migrations/migrate_assignment_state.py), sets every stored market's state and published revision, `--dry-run` first, and is safe to run again.

What each state and event leads to, and the owner's interface: [the assignment's lifecycle](../implementation/modules/assignment-lifecycle.md).

## Consequences

- A test cannot stand on a run the product cannot make: the test fixture refuses a `run` with no `madeFrom`.
- A new screen or refusal reads the served `allocation` rather than re-deriving it.
- The phase stays the market's only lifecycle state ([ADR 0005](0005-phase-is-the-only-lifecycle-state.md)): where the assignment stands is a fact the phase cannot hold, so it is its own field with its own writer, as that ADR asks of such a fact.
- The applicant-facing reads keep the `resultsPublished` flag, since they ask whether applicants were told, not where the allocation stands.
- Which rows applicants were told is not kept, only the revision; each change after results is in the history, which says it came after them.
- Running the migration against production is a release step ([`docs/OPERATIONS.md`](../OPERATIONS.md#starting-a-database-and-migrations)).

## Considered and rejected

- **Deriving the state with no stored field**, from the rows' hand-placed flags and `madeFrom` in one shared function.
  It would close the bug, but the state would still be an inference over fields other writes own, re-derived at every read; an assignment of pins later partly freed, or rows a raw seed wrote, would be judged by whatever the flags happen to say.
  A stored state makes the transitions explicit and testable as a table, and the derivation stays only as the read's fallback and the migration's rule.
