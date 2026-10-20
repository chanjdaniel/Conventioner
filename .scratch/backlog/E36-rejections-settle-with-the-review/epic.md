---
id: E36
title: Rejections settle with the review
type: epic
status: ready
blocked_by: []
pr: []
---

## Outcome

A verdict settles when the market enters assignment, and no rejected vendor holds a seat unless an organizer put them there by hand, warned, and marked for everyone to see.
Every seated person is someone the market has a record of, a vendor added on the day included.
Results go out once the allocation is done, and they settle it.
An applicant reads "Submitted" until then, and afterwards only whether they have a table.

## Why now

The rejection research of 2026-10-20 ([map](../../wayfinding/rejection-visibility/map.md), [research](../../wayfinding/rejection-visibility/walk/research.md)) found that a rejected vendor could stay seated, go live and check in, and that an applicant's label told them a rule had rejected them the moment they submitted.
Settled in the same day's grilling: [decisions](../../wayfinding/rejection-visibility/issues/02-who-sees-a-rejection-and-when.md) 1-14; each story cites the ones it builds.
Feature work, so it waits for the November 2026 market window to close (2026-11-21).

## Features

- `F01` - verdicts settle with the review.
- `F02` - seating anyone, deliberately.
- `F03` - adding a vendor who never applied.
- `F04` - results wait for the allocation.
- `F05` - what an applicant reads.

## Order inside this epic

`F01/S01` first: every later decision assumes no verdict changes once a run can exist.
`F02/S01` before the rest of `F02` and before `F03`, which seat through the dialog it narrows.
`F04/S01` before `F04/S02`.
`F05/S01` is independent and small; `F05/S02` reads best after `F04`, since its outcomes appear only once results are published.

## Out of scope

Waitlist applications, outcome emails, and an offers or decline flow ([map, Out of scope](../../wayfinding/rejection-visibility/map.md#out-of-scope)).
