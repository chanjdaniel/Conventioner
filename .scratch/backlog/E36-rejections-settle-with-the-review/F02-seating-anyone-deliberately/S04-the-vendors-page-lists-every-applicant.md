---
id: E36/F02/S04
title: The Vendors page lists every applicant
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

The Vendors page lists every applicant, not only the approved vendors the run reads (decision 5).
Beside "Unassigned only" it gains "Rejected only", worked the same way: a filter on the page with its own address, so a link or a refresh keeps it.
"Unassigned" keeps meaning approved with no seat: a rejected applicant is never counted as unassigned.
That narrowing was a fix (bug 10: the page and the results disagreed on how many were unassigned), so its test stays and gains the rejected case.

## Acceptance criteria

- [ ] Every applicant of the market appears on the Vendors page, each with their verdict.
- [ ] "Rejected only" shows exactly the rejected applicants, and survives a refresh.
- [ ] The unassigned count on the Vendors page and on the results agree, with rejected applicants on the market.
- [ ] A rejected applicant seated by hand shows their seat like anyone else.
