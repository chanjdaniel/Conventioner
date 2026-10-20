---
id: E36/F04/S01
title: Publish Results waits for a current run
type: story
status: ready
blocked_by: [E36/F01/S01]
pr: []
---

## What to build

Publish Results stays its own button, an admin's, on form markets only (decision 8).
It is available in assignment once a run is stored and is not out of date, and refused in every other phase and while the stored run is out of date, with a reason the page draws in place of the button (decision 9).
Pressing it opens a confirmation saying how many applicants will read each outcome: how many have a table, and how many did not get assigned.
The reason it is unavailable is served on the market read, beside the other per-person reasons, so the page decides nothing itself.

## Acceptance criteria

- [ ] Before assignment, with no stored run, or with an out-of-date run, Publish Results is refused by the server and shown unavailable with the reason.
- [ ] In assignment with a current run it is available, and the confirmation states both counts, matching the stored seats.
- [ ] A CSV market offers no Publish Results, as today.
- [ ] Published results still cannot be unpublished.
