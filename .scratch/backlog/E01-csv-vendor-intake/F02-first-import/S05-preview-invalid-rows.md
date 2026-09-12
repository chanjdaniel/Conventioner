---
id: E01/F02/S05
title: Preview invalid rows and import only the valid ones
type: story
status: in-progress
blocked_by: [E01/F02/S02]
pr: []
---

## What to build

A single malformed row does not block the other two hundred, and the organizer sees exactly what will and will not be imported before anything is written.

The rule is **refuse at the mapping level, tolerate at the row level**. An unmapped required target imports nothing, because that is a configuration error and importing half a form would be nonsense. A row with a garbled email or a missing required answer is listed with its reason, and the organizer either imports the valid rows or cancels and fixes the source.

## Acceptance criteria

- [ ] The preview lists invalid rows with a specific reason each, identified so the organizer can find them in their spreadsheet
- [ ] The preview states the valid and invalid counts before anything is written
- [ ] The organizer can import only the valid rows, or cancel entirely
- [ ] Cancelling writes nothing
- [ ] Importing valid rows writes exactly those, and reports what was skipped afterwards
- [ ] Backend tests cover a mixed file, an all-invalid file, and a clean file
- [ ] An e2e story imports a file containing a malformed row and asserts only the valid rows landed

## Notes

Silently skipping a row is the worst available outcome: the import looks complete and a vendor is simply missing. Everything skipped must be both previewed and reported.

This matters more than it looks because of a decision made elsewhere: the solver **rejects incomplete applications before it runs**, with a blocker naming them. So importing broken rows does not defer the problem, it relocates it to a worse moment - the organizer discovers it when trying to assign, not when importing.
