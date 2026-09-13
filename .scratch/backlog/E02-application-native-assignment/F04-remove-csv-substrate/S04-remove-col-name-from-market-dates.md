---
id: E02/F04/S04
title: Remove col_name from market dates and public check-in
type: story
status: ready
blocked_by: [E02/F04/S03]
pr: []
---

## What to build

A market date is a date.
The column name and column index it has carried since the CSV era are gone, and public check-in no longer depends on either.

This is the last field and the riskiest one.
Check-in builds its date aliases from the column name, and the project's agent memory records that as the specific reason these fields were kept optional rather than deleted through the whole intake redesign.
Check-in is live behaviour on a public URL that a market-day organizer depends on, so this is a check-in change, not only a model change.

Verification therefore goes through the real check-in path, not through a unit test of the alias builder.

## Acceptance criteria

- [ ] The column name and column index are gone from the market-date model
- [ ] Check-in resolves dates without them, and records attendance correctly
- [ ] The solver resolves market dates without them
- [ ] An e2e story checks a vendor in through the public URL on a market created through the application path, and asserts the attendance record
- [ ] A market document written before this change still loads, and its check-in still works
- [ ] `docs/schema.d.ts` is regenerated, and its generation test passes
- [ ] The project's agent memory is updated: the CSV-field runtime coupling it documents no longer exists, and the note should say so rather than be left standing
- [ ] The full suite is green, and no reference to source data, column names, or column indices remains anywhere in the repository

## Notes

This story closes what the agent memory has been calling Phase 5.
Finishing it means the memory entry describing that coupling is now wrong, and a wrong note in a file every session reads is worse than no note.
