---
id: E12/F03
title: A tier with no tables
type: feature
status: ready
blocked_by: []
pr: []
---

## Outcome

A market that has declared a tier and given it no sections says so while the plan is being written,
and refuses to run an assignment that would reject people for it.

## Why now

Sections are a flat list carrying a tier each, and tables are generated from sections, so a tier
with no section has no tables on any date.
That is a property of the plan alone - detectable with no applications and no assignment - and it is
what produced the finding: two vendors unplaced beside nineteen free tables.
