---
id: E02/F01/S02
title: Assign a market from its Applications
type: story
status: done
blocked_by: [E02/F01/S01]
pr: []
---

## What to build

An organizer whose vendors arrived through CSV import runs assignment and gets a real result.

This is the epic's tracer bullet.
`assign_market()` is handed applications instead of a source-data blob, every caller stops fetching source data first, and the solver holds no column index, no column name, and no dynamic attribute lookup.
Assignment statistics, the assignment CSV download, and check-in's recomputation all keep working, because they all go through the same entry point.

An application missing a required answer stops the run before it starts, as a precondition naming the offending applicants, following the existing guard pattern.
It is not skipped: skipping produces an assignment that looks complete with someone silently absent, which is the failure mode this whole epic exists to remove.
In practice this catches imported rows, since form applicants are validated at submission.

Two behaviours change here because the port forces them, not as opportunistic extras:

**Tier becomes a hard filter over the set of tiers the vendor accepts.**
It is currently a substring test against the per-date answer, so a tier named `A` matches an answer of `AB`.
The per-date answer no longer carries tiers at all, so there is nothing to defer this to.
A vendor is never placed at a tier they did not accept, even if that leaves them unassigned, because the tier determines the price the applicant pays for a table that day.

**Flexibility becomes the number of dates a vendor is available.**
It currently sums comma-separated tier tokens across dates, conflating how many days with how many tiers.
That number was an artifact of the CSV encoding, not a designed quantity, and it feeds the tiebreaker that places the most constrained vendors first.

## Acceptance criteria

- [ ] `assign_market()` takes a market and its approved applications, and no caller fetches source data first
- [ ] All six call sites are moved over, including the one behind public check-in
- [ ] The solver and its validator read only typed vendor attributes; no column index, column name, or dynamic attribute lookup remains in either
- [ ] The dead column-values helper is deleted rather than ported
- [ ] A vendor is placed only at a tier they accepted, and a tier whose name is a substring of another no longer matches
- [ ] Flexibility counts available dates
- [ ] An application missing a required answer blocks assignment with a message naming the applicants, and no partial assignment is produced
- [ ] A vendor with no application is not silently skipped
- [ ] Characterisation tests pin the solver's placement behaviour BEFORE the swap, and still pass after it
- [ ] Backend tests cover assignment from applications, the tier filter, and the missing-answer precondition
- [ ] An e2e story imports a CSV, approves the applications, runs assignment, and asserts a real result, with no fabricated source data anywhere in the path

## Notes

The CSV substrate is not deleted here.
Call sites stop using it and F04 removes it, so CI stays green through the middle of the epic.

The e2e seeds still fabricate source data at this point and may keep doing so until F04; do not let that fabrication leak into the new path.

**There is no solver safety net to inherit.** Found while implementing S01: `assign_market` is
monkeypatched away in the assignment-statistics tests, so the only tests that actually run the
solver are the eleven in the column-mapping module - and those exist to test column mapping,
which F04 deletes outright.
Placement itself, half-table pairing, priority ordering and the max-days cap have no coverage at
all.
So this story cannot lean on existing tests to prove the swap preserved behaviour; it has to
write the characterisation tests first, against the CSV path, and then show them still passing
against the application path.
Doing it the other way round proves nothing, because the only witness to the old behaviour would
already be gone.
