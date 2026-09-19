---
id: E14/F02/S03
title: A count of zero is not a warning
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

The Tables view's status pills read "6 assigned", "0 partial", "14 empty".
The partial pill renders amber whatever its value, so a market with nothing partially filled still shows a warning-coloured zero drawing the eye to a non-problem.

A count of zero should not be coloured as a condition to act on.

## Acceptance criteria

- [ ] A zero-valued status pill is not rendered in a warning colour.
- [ ] A non-zero partial count still reads as something to look at.
- [ ] Whatever colours are used still meet AA on their background, per `E09/F01/S03`'s contrast contract.

## Notes

Observed during the 2026-09-20 walk; recorded in the report's smaller findings rather than as a numbered one.
