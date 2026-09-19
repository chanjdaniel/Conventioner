---
id: E10/F02
title: The plan is one page
type: feature
status: in-progress
blocked_by: []
pr: [71]
---

## Outcome

The Market Setup tab is one page holding the whole plan, with no paging and no stored wizard step.

## Why now

The three wizard pages imply an ordering the data does not have.
The only dependency worth respecting - tiers and locations before sections can reference them -
lives entirely inside page 1, and the only cross-page one is dates bounding the max-assignments
clamp.
Paging them is the same mistake as the wizard pretending to be the lifecycle, one level down.
