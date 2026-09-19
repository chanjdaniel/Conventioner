---
id: E11/F02
title: A pin the solver honours
type: feature
status: in-progress
blocked_by: []
pr: [73]
---

## Outcome

A hand-placed vendor keeps their seat when the solver runs, and a pin the plan can no longer satisfy
says so before the next assignment rather than disappearing.

## Why now

A pin is a guarantee, not a suggestion: "sometimes we need to guarantee a certain vendor gets a
certain spot".
Without the solver honouring it, a pin lasts until the next press of Assign.
