---
id: E01/F03/S03
title: Return changed approved applications to review
type: story
status: in-progress
blocked_by: [E01/F03/S02]
pr: []
---

## What to build

When a re-import changes an answer the solver reads, an already-approved application goes back to `open` for re-review. When it changes anything else, the approval stands.

An organizer approved a vendor on the strength of what they saw. If that vendor's availability or tier changes afterwards, the approval is stale and the solver would otherwise place someone against constraints nobody accepted. A corrected Instagram handle is not that, and must not undo a review.

The count is shown **before** committing - "3 approved applications will return to review because their answers changed" - so neither direction is ever a surprise.

## Acceptance criteria

- [ ] A changed solver-relevant answer on an approved application returns it to `open`
- [ ] A changed non-solver-relevant answer leaves the status untouched and updates the data
- [ ] Which answers count as solver-relevant is defined in one place, not restated per call site
- [ ] The preview states how many applications will return to review, before anything is written
- [ ] Applications not previously approved are unaffected by this rule
- [ ] An unchanged answer does not count as a change, including where a value merely reformats
- [ ] Backend tests cover each combination of changed/unchanged against approved/unapproved
- [ ] An e2e story approves an application, re-imports it with a changed availability, and asserts it returned to review

## Notes

Both blanket alternatives were rejected: keeping the approval always lets edited answers slip past review entirely, and reverting always can silently un-approve dozens of vendors mid-review and make the organizer redo the lot.

"Merely reformats" is worth care - a re-export can change a date's rendering or a value's whitespace without the applicant touching anything, and treating that as a change would un-approve a market's worth of vendors for nothing.
