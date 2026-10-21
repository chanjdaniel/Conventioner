---
layer: business
kind: rule
describes:
  - back-end/assignment/assignment.py#IncompleteApplicationsError
  - back-end/assignment/assignment.py#solver_vendors_for
  - back-end/essential_fields.py#asked_essential_keys
  - back-end/essential_fields.py#REQUIRED_ESSENTIAL_KEYS
verified: 2026-10-22
sources:
  - wayfinding/v0-1-0/02
  - E02
  - bug/42
---

# An incomplete application refuses the run

An approved application missing an answer to a question the market asked refuses the whole assignment run, naming every such applicant and what each one lacks.
Nobody is skipped, and no partial assignment is stored.

**Requiredness is defined by what the market asked**, not by a fixed list.
A question the plan offers nothing for is not asked: no dates, no date questions; no tiers, no tier question; fewer than two sections or table types, no ranking; a ranking the organizer switched off, not asked either.
In every market the table-type ranking is unasked, since table type is stubbed to one type, so an empty ranking there is a complete answer; a fixed list would reject every application in the product.
Of the questions asked, every one is required except the preferred name, the table-share partner and the vendor's request; and an import may leave the number of dates unanswered ([what an import may leave unasked](what-an-import-may-leave-unasked.md)).

**An answer the market no longer offers is not missing.**
A tier or a date the market's offering no longer holds is dropped from the answer, so the vendor may be unplaceable and reported unassigned; the applicant did nothing wrong, and stopping the market over the organizer's own change would be out of proportion.
Only an answer that is absent refuses the run.

**Serves:** [Every approved vendor gets a table by the market's rules](../intents/every-approved-vendor-gets-a-table-by-the-markets-rules.md).

## Why

It is part of [applications are the solver's only input](../../adr/0003-applications-are-the-solvers-only-input.md).
Skipping the offending vendors would hand back an assignment that looks complete with someone silently missing, and nobody would have a reason to look.
Naming the applicants, not counting them, is what lets the organizer go and fix it: the refusal (400) carries each application's id, so the page can link to it (bug 42).
In practice it catches imported rows, since the online form validates the same questions at submission.

## Where it is kept

- `asked_essential_keys()` in [`back-end/essential_fields.py`](../../../back-end/essential_fields.py) is the single statement of what is asked, read by the applicant validator and the solver's input translation alike; two copies would drift, and the drift would show as the solver rejecting answers the form had just accepted ([essential fields](../../implementation/modules/essential-fields.md)).
  `REQUIRED_ESSENTIAL_KEYS` beside it says which asked questions must be answered.
- The translation reports each incomplete application (`IncompleteApplication` in `vendor_input.py`), and `solver_vendors_for` raises `IncompleteApplicationsError` in [`back-end/assignment/assignment.py`](../../../back-end/assignment/assignment.py) before anything is placed ([the assignment solver](../../implementation/modules/assignment-solver.md)).
- `POST /markets/:id/assignment` answers it with the message and the `incomplete` list ([placements](../../implementation/modules/placements.md)); the read-only views that compute from the applications answer it too.
- The cases are `TestAnIncompleteApplicationStopsTheRun` in [the assignment behaviour suite](../../implementation/testing/assignment-behaviour-suite.md).
