---
id: E01/F02/S01
title: Extract the shared application-write path
type: story
status: in-progress
blocked_by: [E01/F01/S01, E01/F01/S02, E01/F01/S03]
pr: []
---

## What to build

Pure prefactor. **No behaviour changes**, so the existing suite is the proof.

The sequence that records an applicant's answers - validate the essential answers, freeze the offering, persist, set status - lives inline in the applicant endpoint. Pull it into one function and make that endpoint its first caller. The importer then calls the same function instead of reimplementing it.

## Why it must exist

An imported application and a form-submitted application must be **the same kind of document**, or the solver reads two shapes and the review UI shows two behaviours. Three things the applicant endpoint does today are easy to omit in a second implementation:

1. **It freezes the essential offering before persisting**, and re-validates if a concurrent freeze won a different offering. An answer recorded against an unfrozen offering can have the questions moved under it by a later plan edit.
2. **It normalises answers through the shared validator** into the stored shapes - dates as ISO strings in plan order, max dates as an int, rankings best-first.
3. **It sets the status to `open`.**

Making this a shared function makes "the two paths cannot diverge" a property of the code rather than a promise two implementations make. Without it they drift the first time either changes, which is exactly how the essential-questions contract and the solver drifted apart in the first place.

## Acceptance criteria

- [ ] One function owns validate, freeze, persist, and set-status for an applicant's answers
- [ ] The applicant endpoint calls it and behaves identically; no endpoint contract changes
- [ ] The freeze-before-persist ordering and the concurrent-freeze re-validation are preserved exactly
- [ ] The function is callable without an HTTP request or an applicant session, so an importer can use it
- [ ] The existing backend and e2e suites pass unchanged, with no new assertions needed to prove behaviour held

## Notes

`find_or_create_application` writes with `$setOnInsert` and therefore **cannot update** an existing document. It creates; it does not overwrite. Do not route updates through it.
