---
id: E01/F01/S02
title: Add table choice and table-share partner
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

An applicant says whether they want a full table, a half table, or either, and may optionally name the vendor they would like to share with by email.

Both are answers the solver already reads, and neither has any source in the essential questions today. Every table holds one full-table vendor or two halves, and a vendor who names a valid partner is placed at the same table as them.

The partner field is **optional and normally empty**. An applicant with nobody in mind leaves it blank and may be paired with a stranger, which is already the implemented fallback.

## Acceptance criteria

- [ ] The applicant form asks table choice, offering full table / half table / either
- [ ] The applicant form offers an optional table-share partner email
- [ ] A blank partner email is valid and stores as empty, not as a validation error
- [ ] Both appear in the organizer's read-only essential-questions panel
- [ ] Table choice is required; submitting without it is rejected
- [ ] The shared market contract declaration is regenerated
- [ ] Backend tests cover both fields, including the empty-partner case
- [ ] An e2e story has an applicant answer both and asserts the persisted shape

## Notes

A first-class reference between two applications is the better eventual model for sharing than a free-text email that may match nobody, but it needs identity resolution that imported rows do not have. Ticket 05 records that; keep the email string for now.

Naming matters here: **table choice is not table type.** Table type is the physical kind of table, a floorplan concept. See `CONTEXT.md`.
