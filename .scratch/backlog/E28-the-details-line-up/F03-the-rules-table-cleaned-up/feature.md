---
id: E28/F03
title: The priority rules table is cleaned up
type: feature
status: done
blocked_by: []
pr: [#94]
---

## Outcome

The priority rules table on the assignment page is drawn from the design system's primitives and tokens: its columns line up, its controls are the product's controls, and the "Answers, best first" list reads as a ranked list.

## Why now

Brain dump 2026-10-09: "Answers, best first" needed proper spacing and alignment.
The answers column cannot look right while the rest of the table around it is drawn locally, so the cleanup covers the whole table.
It is a cleanup against `docs/design-system.md`, so it needs no prototype.

## Stories

- `S01` - the rules table is drawn from the primitives.
