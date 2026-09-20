---
id: E09/F04/S02
title: One date format, and it includes the year
type: story
status: done
blocked_by: []
pr: [69]
---

## What to build

A market date renders one way across the product.
Today it renders five:

| Screen | Rendering |
| --- | --- |
| Market Dates editor | `Saturday, November 21` - **no year** |
| Import preview, applicant card | `Saturday, November 21, 2026` |
| Import value reconciliation | `2026-11-21` |
| Assignment Results, Per Date | `Nov 21, 2026` |
| Assignment Results, Unassigned Tables | `November 21, 2026`, 300px from the line above |
| Triage card, submitted | `9/3/2026` |
| Check-in confirmation | `9/15/2026, 7:20:18 AM` |

The missing year is the defect: a 2026 market and a 2025 market are indistinguishable at the point where you type them in.
The rest is consistency.
`getFormattedDate` in `front-end/src/utils/utils.ts` is already the single owner and formats with pure UTC math, which must not change - a stored `YYYY-MM-DD` renders as the same calendar day for every viewer.

## Acceptance criteria

- [ ] One canonical long form and at most one short form, both including the year, both from `getFormattedDate`.
- [ ] The Market Dates editor shows the year.
- [ ] The import value reconciliation offers dates in the canonical form, not ISO.
      This is the surviving half of [ticket 05](../../../wayfinding/readable-journey/issues/05-match-before-splitting.md):
      it lists `2026-11-21`, a format shown nowhere else in the product, on the path every CSV
      market walks.
- [ ] A check-in confirmation shows a time a human would say aloud, not seconds.
- [ ] `front-end/e2e/date-display-timezone.spec.ts` still passes across Honolulu, LA and Tokyo.
