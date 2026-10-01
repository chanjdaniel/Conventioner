---
id: E26/F02/S03
title: No days column means no personal limit
type: story
status: done
blocked_by: []
pr: []
---


## What to build

"Number of dates you want" is no longer required at import: a file with no column for it imports, and each applicant has no personal limit, bounded by the market ceiling.
The proposal says so instead of "Not asked"; online applicants are still asked.

Closes bugs 24 in `docs/MVP_BUGS.md`; each one's reproduction there is the starting E2E.

## Acceptance criteria

- [x] The anonymised 2024 and spring 2025 exports can be started from and reach the preview.
- [x] An imported applicant with no limit is placed on as many dates as they are available for, up to the market ceiling.
- [x] The online form still requires the question.
