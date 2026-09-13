---
id: E03/F02/S01
title: A market declares how vendors reach it
type: story
status: done
blocked_by: []
pr: [#65]
---

## What to build

An organizer setting up a market says how vendors will reach it: by CSV import, or by the public application form.
Exactly one, no hybrid.

They can say so while the market is in `draft`.
Once the market leaves `draft` the answer is fixed: a later update that carries a different value is ignored and the stored value stands, because switching intake mid-lifecycle strands whatever the previous mode produced.
This is the same single-writer shape `phase`, the application form and the import mapping already have.

A market document written before this field existed has no intake mode, and reads as CSV.
The public applicant surface is therefore off unless a market explicitly says otherwise, which is the safe direction: wrongly hiding an application surface is visible and gets complained about, wrongly exposing one is silent until a stranger applies.
No migration and no backfill.

This story ships no organizer UI control.
That is deliberate, not an omission: every MVP market is CSV, and a toggle would advertise a form-intake surface that MVP withholds.
The field is real, tested and writable through the market API; the control arrives with form intake.

## Acceptance criteria

- [ ] A market carries an intake mode of exactly `csv` or `form`, persisted camelCase like every other market key
- [ ] `POST /markets` may carry an intake mode, and a market created without one is CSV
- [ ] A market PUT while the market is in `draft` may change the intake mode
- [ ] A market PUT once the market has left `draft` cannot change it: the stored value is re-applied over the request body
- [ ] A stored document with no intake mode reads as CSV wherever the value is asked for
- [ ] An unrecognized stored value reads as CSV rather than raising, and is not silently rewritten
- [ ] The market schema contract carries the field and `docs/schema.d.ts` is regenerated from it
- [ ] Back-end tests cover: creation with and without the field, the draft-edit path, the frozen path from each non-draft phase, absence, and an unrecognized value

## Notes

`AGENTS.md` is explicit that market documents are stored camelCase and that reads may name no other spelling, and that anything touching a raw document goes through `back-end/market_documents.py`.

The freeze test is "the market has left `draft`", not any particular later phase.
Deriving it from `phase` keeps it in step with the phase machine rather than duplicating a list of phases that would drift as edges are added.
