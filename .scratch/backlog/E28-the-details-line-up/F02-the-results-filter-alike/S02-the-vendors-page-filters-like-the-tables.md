---
id: E28/F02/S02
title: The vendors page filters as the tables page does
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

The vendors page gets the tables page's date, section, tier and table filters, from **one filter bar** both pages use and under **the same address keys**, so a filter set on one page is still set on the other.

The filters ask **where the vendor is placed**, because this is the results of an assignment and it answers "who is where":

- **Date**: vendors placed on that day.
- **Section** and **tier**: vendors placed there - on the chosen date when one is set, on any of their dates otherwise.
- **Table**: how they are **placed as** (full or half), not their table choice; an "Either is fine" applicant is found by what they got.
- A vendor with no placement drops out under any of these filters.

The search box and "Unassigned only" stay.
"Unassigned only" with a date reads as "not placed that day".
The summary on the right counts the vendors the filters leave.

## Acceptance criteria

- [x] Each filter narrows the vendors by placement as above, alone and combined.
- [x] Setting a date on the tables page and opening the vendors page shows the same date set, and back again.
- [x] Search and "Unassigned only" combine with the filters.
- [x] Both pages render the filter bar from the same component; the tables page's existing testids keep working.
- [x] Every control in the bar is named (`every-control-is-named.spec.ts` walks the vendors page with a filter set).
