---
id: E01
title: CSV vendor intake into Applications
type: epic
status: done
blocked_by: []
pr: [#49, #50, #51, #52, #53, #54, #56, #57, #58, #59, #60, #61]
---

## Outcome

An organizer imports the CSV their Google Form produced, maps its columns onto the market's essential questions, and ends up with reviewable `Application` records - the same record type the native application form produces.

## Why now

This is the MVP's answer to "set up the vendors", and it is the half of the intake redesign that was never built.
PR #42 deleted the CSV upload UI as the last step of the cutover, but the native form never became a working path to assignment, so today there is no way at all to get vendors into a market through the product.

Importing into `Application` rather than restoring `source_data` is what makes the earlier application-form investment pay off: both intakes converge on one record, so switching the native form on later needs no new assignment work.

## Decisions

All settled. Read these before writing stories:

- [04: CSV column mapping - UX and persistence](../../wayfinding/v0-1-0/issues/04-csv-mapping-ux.md) - the flow's shape, where the mapping is stored, failure posture, value matching, and the `Timestamp` column.
- [05: Re-import and applicant identity semantics](../../wayfinding/v0-1-0/issues/05-reimport-and-identity.md) - upsert on `(market_id, applicant_email)`, when a re-import returns an approved application to review, and which phases permit import.
- [01: Reconcile the essential-fields contract with the solver's inputs](../../wayfinding/v0-1-0/issues/01-reconcile-essential-fields-with-solver.md) - the seven targets a CSV column maps onto.
- [06: Intake mode on Market](../../wayfinding/v0-1-0/issues/06-intake-mode-semantics.md) - the field that marks a market CSV-intake in the first place.

Note that `find_or_create_application` writes with `$setOnInsert` and therefore **cannot update**; re-import needs its own write path.

The mapping-screen decision came from a three-variant prototype, kept on the unmerged branch **`prototype/csv-mapping`**. Drive it before building the real screen, but rewrite rather than lift: it has no tests, no error handling and no backend.
