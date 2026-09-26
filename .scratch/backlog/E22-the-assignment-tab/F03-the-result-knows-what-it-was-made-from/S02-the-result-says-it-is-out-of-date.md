---
id: E22/F03/S02
title: The result says it is out of date
type: story
status: done
blocked_by: [E22/F03/S01]
pr: [#83]
---

## What to build

An organizer reading the assignment while the market is in `assignment` sees, when it is out of date, one quiet line saying what changed since it ran - "Your rules and the approved applications changed since this assignment ran" - and how to bring it up to date: run it again.

It is a fact, not an error: no dismiss, no alarm styling.
Running again clears it.
It is shown only in `assignment`, the one phase in which the organizer can act on it.

Where on the page it sits follows the Result page's layout ([the-assignment-tab 02](../../../wayfinding/the-assignment-tab/issues/02-how-every-market-screen-is-reached.md)); until that lands it sits at the top of the current results.

## Acceptance criteria

- [x] In `assignment`, an out-of-date assignment shows the line, naming each changed group in plain words.
- [x] An up-to-date assignment, or one not known to be out of date, shows nothing.
- [x] Outside `assignment`, nothing is shown.
- [x] Editing a rule and then opening the result shows the line without a reload (the store re-reads after the plan saves).
- [x] Pinned by an e2e spec: run, change a rule, see the line, run again, see it gone.
