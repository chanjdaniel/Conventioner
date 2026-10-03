---
id: E26/F02/S02
title: The import writes only what it imports
type: story
status: done
blocked_by: []
pr: [88]
---


## What to build

Rows the preview skips are not written; a row whose email is not an address is skipped with a reason; an applicant listed more than once in a file is judged on their last row, so an unchanged repeat applicant keeps their decision.

Closes bugs 5, 34, 35 in `docs/MVP_BUGS.md`; each one's reproduction there is the starting E2E.

## Acceptance criteria

- [x] An import with skipped rows leaves the market holding exactly the imported rows.
- [x] A row with an invalid email is skipped, naming why.
- [x] Re-importing a file with repeat rows leaves an unchanged applicant's decision alone, and the preview and result counts agree.
