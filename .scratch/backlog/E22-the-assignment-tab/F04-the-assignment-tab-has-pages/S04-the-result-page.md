---
id: E22/F04/S04
title: The Result page is the assignment, read and changed
type: story
status: ready
blocked_by: [E22/F04/S03]
pr: []
---

## What to build

The Result page is where the assignment is read and changed, in one place. Top to bottom:

1. The out-of-date line, when there is one ([E22/F03/S02](../F03-the-result-knows-what-it-was-made-from/S02-the-result-says-it-is-out-of-date.md)).
2. **A summary strip**: vendors placed, tables used, unassigned, satisfaction; **Statistics** and **Download CSV** at its end. "Unassigned" leads to the Vendors page filtered to the unassigned.
3. **The tables grid**, with its filters and its seat editing (fill, free, swap) - the Tables screen, moved in.
4. **The placement history.**

Before the first run the page says there is no assignment yet and links to the Assignment page; where the phase refuses a run, it says why in `assign_phase_refusal`'s words.

The **Unassigned Tables** list is retired: the grid's "empty" filter shows those tables on the grid itself.
The old results component is retired with it; nothing else renders the summary.

## Acceptance criteria

- [ ] Result shows the strip, the grid with seat editing, and the history, for a market with an assignment.
- [ ] Filling, freeing and swapping a seat work from Result exactly as they did on Tables, and the strip updates without a reload.
- [ ] "Unassigned" opens Vendors filtered to the unassigned.
- [ ] Download CSV downloads the stored assignment.
- [ ] With no assignment, Result says so and links to the Assignment page, with the phase's reason where a run is refused.
- [ ] The e2e specs that used Tables and the results page reach the same behaviour through Result.
