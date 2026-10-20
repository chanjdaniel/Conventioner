---
id: E36/F04/S02
title: Publishing settles the assignment
type: story
status: ready
blocked_by: [E36/F04/S01]
pr: []
---

## What to build

Once results are published, the assignment is not re-run: Assign is refused with a reason, and seats change only by hand (decision 10).
The assignment rules (priority, ceiling, half-table share) lock with it, on the plan write and on the page.
A form market cannot go live until its results are published: one more guard on the move to market days, its own blocker line on the rail (decision 11).
A CSV market goes live as today.

## Acceptance criteria

- [ ] After publishing, a run is refused with a reason, and placing, freeing and swapping by hand still work.
- [ ] After publishing, a change to the assignment rules is refused, and the page draws them read-only.
- [ ] A form market with results unpublished cannot move to market days, and the rail says why before the click.
- [ ] A CSV market moves to market days without publishing.
- [ ] The market journey spec publishes before going live.
