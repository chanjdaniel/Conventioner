---
id: E01/F06
title: A required question can be declared not asked
type: feature
status: ready
blocked_by: []
pr: []
---

## Outcome

An organizer whose intake cannot answer a required question can say so, and a default is stored -
for rankings only.

## Why now

Tier is a property of a section, so a market offering three tiers needs three sections, which makes
section preference required - and a Google Form that never mentioned sections cannot answer it. The
import is blocked outright: Preview never enables.

Decided by
[ticket 03](../../../wayfinding/real-market-readiness/issues/03-when-the-csv-cannot-answer.md).

## Shape

- Offerable for **rankings only** - section preference, table type preference. Never for available
  dates, tier preference or table choice, where a default invents a commitment the applicant never
  made.
- That limit is **one rule beside `asked_essential_keys()`**, not a flag per question.
- Recorded **on the market's application form**, beside `essentialOptions`, so it holds for the
  native form too and stays visible to the single statement of requiredness.
