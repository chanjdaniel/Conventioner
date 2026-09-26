---
id: E19/F01/S01
title: The shape rule has one owner
type: story
status: done
blocked_by: []
pr: []
---

## What to build

Nothing changes for an organizer or an applicant.
This is the prefactor: the rule that turns a combined day-grid into the stored answer moves to the module that owns the essential-questions contract, and the import path calls it instead of implementing it.

Two conversions are involved, both currently inline in the import path:

- A **flat** tier answer plus a list of dates becomes those tiers on every one of those dates.
- A **per-date** grid with no separate availability answer yields the availability: the dates a tier was named for are the dates the applicant is available.

## Why it has to come first

`S02` makes the applicant form produce the combined shape.
Without this move, that rule would exist in two places in two languages, and the project's standing rule for this contract is that one module owns it with a single front-end mirror.
A third copy in the import path is exactly the drift that would surface as the solver rejecting answers the form had just accepted.

## Acceptance criteria

- [ ] Both conversions live in the essential-questions contract module, and the import path calls them rather than reimplementing them.
- [ ] The front-end mirror is updated in step, so the two statements of the contract still agree.
- [ ] **No behaviour changes.** The existing import tests pass unedited, including the suite that asserts the real export's shapes - the grid columns as one question, `None` meaning unavailable, and availability read from the grid.
- [ ] The rule that a required target is satisfied by a per-date grid - because the grid answers availability too - is preserved, and still stated once rather than in each caller.
- [ ] Back-end tests cover both conversions directly, without a database, now that they are reachable on their own.
- [ ] The type check and the back-end suite pass.

## Explicitly out of scope

Do not change the applicant form, the validation messages, or any stored shape.
Those are `S02`.
