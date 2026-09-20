---
id: E16/F07
title: Slice: the market workspace
type: feature
status: blocked
blocked_by: [E16/F04, E16/F03]
pr: []
---

## Outcome

Market Setup and its four tabs, Tables, Vendors and Attendance are on the design language.

## Scope

`MarketSetupView` and `components/elements/*`, `TablesView`, `VendorsView`, `AttendanceStatusView`, `AssignmentResults`, `PhaseRail`, `PlacementDialog`, the form builder and the triage queue.

The largest slice and the last of the organizer surfaces, because it is the one `E16/F03` will have just rewritten. It holds the legacy halo shadow, the inset 'pressed' fields, every `Element*Setup` panel, and the two design languages rendering side by side on Assignment Results.

## Done means

- Every control on these screens comes from a primitive; no local height, padding, radius or shadow.
- Type and spacing on these screens are on the scale in `docs/design-system.md`.
- Stylelint's rules are flipped from warning to **error** for these files (`E16/F02/S02`).
- The contrast sweep covers these screens, including their dialogs and empty states.
- A before/after screenshot pair is attached to the PR, because this is the kind of change a diff does not show.
