---
id: E36/F04/S01
title: Publish Results waits for a current run
type: story
status: done
blocked_by: [E36/F01/S01]
pr: [#116]
---

## What to build

Publish Results stays its own button, an admin's, on form markets only (decision 8).
It is available in assignment once a run is stored and is not out of date, and refused in every other phase and while the stored run is out of date, with a reason the page draws in place of the button (decision 9).
Pressing it opens a confirmation saying how many applicants will read each outcome: how many have a table, and how many did not get assigned.
The reason it is unavailable is served on the market read, beside the other per-person reasons, so the page decides nothing itself.

## As built

- `publish_results_refusal` (`api/applicants.py`), served with the admin check as `publishResultsReason`; `publishOutcomes` counts each outcome with `result_outcome`, the rule the applicant page reads.

## Acceptance criteria

- [x] Before assignment, with no stored run, or with an out-of-date run, Publish Results is refused by the server and shown unavailable with the reason.
- [x] In assignment with a current run it is available, and the confirmation states both counts, matching the stored seats.
- [x] A CSV market offers no Publish Results, as today.
- [x] Published results still cannot be unpublished.
