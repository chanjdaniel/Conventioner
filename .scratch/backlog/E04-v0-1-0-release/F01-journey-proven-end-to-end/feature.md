---
id: E04/F01
title: The MVP journey proven end to end
type: feature
status: ready
blocked_by: []
pr: []
---

## Outcome

One test walks the whole MVP journey as an organizer would: create a market, set it up, import a
Google Forms CSV, review and approve the vendors who applied, and generate an assignment - in a
single session, through the UI, with no API seeding and no writes straight into Mongo.

## Why now

E01, E02 and E03 each built and tested a slice, and the slices do not meet.

- The market pipeline suite begins at "approved vendors exist": it creates the market over the API
  and seeds applications already at `reviewer_approved`.
- The CSV import suite ends at "rows are applications at status `open`", and asserts that over the
  API rather than in the monitor.
- Nothing in the whole e2e suite has ever clicked Approve. Every fixture that needs an approved
  application writes the status directly.

So the one step that decides who the solver sees - review - has no end-to-end coverage at all, and
the seam between import and assignment has never been walked. Slice coverage is exactly what missed
the publishing seam bug E03 found in F02/S04, and this is a larger seam.
