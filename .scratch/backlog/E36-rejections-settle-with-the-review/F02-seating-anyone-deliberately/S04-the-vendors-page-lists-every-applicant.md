---
id: E36/F02/S04
title: The Vendors page lists every applicant
type: story
status: done
blocked_by: []
pr: [#116]
---

## What to build

The Vendors page lists every applicant, not only the approved vendors the run reads (decision 5).
Beside "Unassigned only" it gains "Rejected only", worked the same way: a filter on the page with its own address, so a link or a refresh keeps it.
"Unassigned" keeps meaning approved with no seat: a rejected applicant is never counted as unassigned.
That narrowing was a fix (bug 10: the page and the results disagreed on how many were unassigned), so its test stays and gains the rejected case.

## As built

- Every application is listed; `inTheRun` comes from the tables read, so the count stays the run's. Outside the run a row shows its verdict chip, or Added for a vendor added by hand; inside it, Assigned or Unassigned, since everyone in the run is approved.
- `?show=unassigned` and `?show=rejected` are toggles in the toolbar.

## Acceptance criteria

- [x] Every applicant of the market appears on the Vendors page, each with their verdict.
- [x] "Rejected only" shows exactly the rejected applicants, and survives a refresh.
- [x] The unassigned count on the Vendors page and on the results agree, with rejected applicants on the market.
- [x] A rejected applicant seated by hand shows their seat like anyone else.
