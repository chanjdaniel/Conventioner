---
id: E36/F05/S02
title: Two outcomes after
type: story
status: ready
blocked_by: [E36/F05/S01]
pr: []
---

## What to build

Once results are published, the applicant's page leads with one of two outcomes (decision 13).
"You have a table" lists the table and date for each date they are seated, a rejected vendor seated by hand and a vendor added on the day included.
"You did not get assigned" covers everyone else: rejected, approved without a seat, and declined alike, with no reason ever shown.
The outcome is worked out from the stored seats on every read, so a hand change after publishing shows on the next load.
No email is sent.

## Acceptance criteria

- [ ] After publishing, a seated applicant reads "You have a table" with each table and date, and an unseated one "You did not get assigned", whatever their verdict.
- [ ] A rejected applicant seated by hand reads "You have a table"; an approved one whose seat is freed reads "You did not get assigned" on the next load.
- [ ] The applicant read serves no verdict or reason after publishing either, only the outcome and the seats.
- [ ] One E2E spec reads both outcomes on one published market.
