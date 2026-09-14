---
id: E01/F04/S02
title: A submission timestamp is stored as a moment
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

The CSV import normalises `submitted_at` to ISO-8601 on the way into the document, so every reader
compares one shape. The public applicant form already writes ISO; only this path disagreed.

An unreadable value **refuses the row and names it**, rather than scoring `math.inf` in silence.
The refusal applies only when the column is mapped - `submitted_at` stays optional.

When no timestamp column is mapped *and* the market has a `submitted_at` priority rule, say so in
the ledger: that combination is the silent no-op in a new disguise.

A plain migration script rewrites stored raw timestamps. No boot marker: this hazard is loud.

Decided by
[ticket 01](../../../wayfinding/real-market-readiness/issues/01-when-a-timestamp-becomes-a-moment.md).

## Acceptance criteria

- [ ] A Google Forms `M/D/YYYY H:MM:SS` timestamp is stored as ISO-8601.
- [ ] `_as_magnitude` returns a real magnitude for every imported application, so "earliest first" actually orders.
- [ ] The review queue's `submitted_at` sort is chronological (it sorts the same stored value).
- [ ] A row whose mapped timestamp cannot be parsed is refused and named in the preview.
- [ ] A CSV with no timestamp column still imports.
- [ ] The ledger warns when no timestamp is mapped and a `submitted_at` priority rule exists.
- [ ] A test asserts ordering against `tests/test_data/google_forms_export.csv`, whose unpadded months and hours are the case that broke it.
