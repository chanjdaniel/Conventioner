---
id: E01/F01/S01
title: Split availability from tier preference
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

An applicant answers two separate questions: which market dates they can attend, and which tiers they will accept.

Today these are one question wearing two hats. Each market date carries its own answer holding a string of acceptable tiers, and the solver decides placement with a substring test of the table's tier name against that string. Availability and tier preference are therefore impossible to state independently, and a tier named `A` matches an answer of `AB`.

After this story, availability is plain availability, and tier preference is one question over the market's tiers. The solver treats tier as a **hard filter**: a vendor is never placed at a tier they did not accept, even if that leaves them unassigned, because the tier determines what they pay for a table on a given day.

## Acceptance criteria

- [ ] The applicant form asks availability and tier preference as separate questions
- [ ] Tier preference offers the market's configured tiers and stores the accepted set
- [ ] Availability keeps its existing stored shape (ISO date strings in plan order)
- [ ] Tier matching is set membership, not a substring test; a tier named `A` does not match an answer of `AB`
- [ ] The organizer's read-only essential-questions panel shows both
- [ ] The shared market contract declaration is regenerated
- [ ] Backend tests cover the new validation, including a rejected tier not on offer
- [ ] An e2e story has an applicant answer both and asserts the persisted shape

## Notes

`essential_fields.py` is the single owner of this contract, with a deliberate front-end mirror; both move together.

The solver's tier check is one of the seven dynamic-attribute sites [ticket 02](../../../wayfinding/v0-1-0/issues/02-solver-vendor-input-model.md) enumerates. This story changes what is *asked and stored*; E02 changes what the solver *reads*. Keep the solver's existing read path working until then.
