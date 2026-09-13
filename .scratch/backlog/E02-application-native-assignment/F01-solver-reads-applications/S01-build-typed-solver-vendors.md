---
id: E02/F01/S01
title: Build approved applications into typed solver vendors
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

The solver package gains its own input contract: a typed vendor carrying the seven essential fields as named attributes, and the translation that builds one from an `Application`.

Nothing consumes it yet.
This is the expand half of the swap, so it lands beside the existing CSV path without disturbing it, and every assignment still runs exactly as it does today.

The translation lives inside the solver package, not in the applications API.
The solver owns what it needs from an application; the applications API owns application storage and should not carry solver knowledge.
The point of the separation is that the mapping is unit-testable without constructing a market assignment or touching Mongo.

Only approved applications are eligible.
`ApplicationsApi` can count by status but cannot list by it, so this adds that one query method.

The typed model is the whole reason for the story.
Today a vendor is a bag of attributes named after spreadsheet headings, read back with a defaulting `getattr`, so a renamed or mistyped field reads as "the vendor answered nothing" and the market simply assigns oddly.
There is no failure signal at all, and that single property is the direct cause of both defects this feature fixes.

## Acceptance criteria

- [ ] A typed vendor model carries all seven essential fields, with the number of dates wanted as an integer and available dates as dates, not strings re-parsed at each use
- [ ] The optional table-share partner is representable as absent, and absent is the normal case
- [ ] A translation function turns an application into that model, and is unit-tested with no database and no market assignment
- [ ] `ApplicationsApi` exposes a status-filtered list of applications for a market
- [ ] An application missing a required answer is reported by the translation rather than silently yielding a blank-answered vendor
- [ ] The existing CSV assignment path is untouched and every existing solver test still passes

## Notes

The number of dates wanted is stored as an integer by the essential-fields contract.
The old code read `max_days_val[0]`, which truncates `"12"` to `1` on a string and raises on an integer.
Do not carry either shape forward; the typed model is what makes the question moot.
