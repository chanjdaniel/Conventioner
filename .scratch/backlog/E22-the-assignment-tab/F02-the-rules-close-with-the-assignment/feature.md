---
id: E22/F02
title: The assignment rules close with the assignment
type: feature
status: done
blocked_by: []
pr: [#83]
---

## Outcome

The assignment rules can be changed while they can still take effect, and not after.
Past the `assignment` phase nothing can run again, so a changed rule would change nothing; the page says so, and the server refuses the change.

## Why now

Decided in [the-assignment-tab 01](../../../wayfinding/the-assignment-tab/issues/01-what-is-on-each-page.md).
Today the rules stay editable in every phase and the plan write stores them, so an organizer can adjust a priority on market day and believe it did something.

## Stories

- `S01` - the plan write refuses a change to the assignment rules after `assignment`.
- `S02` - the rules read as settled after `assignment`, and say why.
