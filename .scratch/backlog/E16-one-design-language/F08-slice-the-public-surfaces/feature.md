---
id: E16/F08
title: Slice: the public surfaces
type: feature
status: ready
blocked_by: [E16/F04]
pr: []
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
