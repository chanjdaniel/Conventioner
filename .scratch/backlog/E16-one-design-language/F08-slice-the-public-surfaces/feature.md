---
id: E16/F08
title: Slice: the public surfaces
type: feature
status: done
blocked_by: [E16/F04]
pr: [77]
---

## Outcome

The check-in page and the CSV import wizard are on the design language.

## Scope

`AttendanceCheckinView`, `CsvImportView`, `PageNotFound`.

Small and last. The check-in page is already the best-executed surface in the product and needs little beyond the tokens - **keep its 390px behaviour exactly**, which the walk measured as clean: no horizontal scroll, no overflow, no contrast failure.

The import wizard is the odd one: a third page chrome with no card, no rail and a 32px gutter where the lists use 40px, and a four-step indicator that is plain text rather than a stepper. Restyle it onto the language here; whether it should wear the market chrome at all is an open question for a later map.

## Done means

- Every control on these screens comes from a primitive; no local height, padding, radius or shadow.
- Type and spacing on these screens are on the scale in `docs/design-system.md`.
- Stylelint's rules are flipped from warning to **error** for these files (`E16/F02/S02`).
- The contrast sweep covers these screens, including their dialogs and empty states.
- A before/after screenshot pair is attached to the PR, because this is the kind of change a diff does not show.

## Done

The check-in page, the import wizard, `PageNotFound`, and `LoadMarketOverlay` - which is organizer
surface no slice had claimed, so it is picked up here rather than left as the one unmigrated screen
an organizer reaches.

The check-in page needed least, as expected: it was already the best-executed surface in the
product. Its 390px behaviour is unchanged and still pinned by `checkin.spec.ts`.

## What this epic deliberately does not migrate

174 warnings remain, and every one of them is in a surface MVP does not serve:

- **The floorplan GUI** (143 warnings across 11 components). Explicitly cut from MVP; `E15` left it
  alone for the same reason, and its `#00ff00` selection stroke is recorded as H12 in the report.
- **The applicant-facing views** (31 across four). Built and merged, but switched off by intake
  mode - every MVP market is CSV, so no applicant reaches them.

Both are one `overrides` entry away from being gated when they are picked up. The point of the
numbers dropping 1150 -> 174 is not that the number is small; it is that **every screen MVP
actually serves is migrated and its rules are errors**, so the remainder cannot grow.
