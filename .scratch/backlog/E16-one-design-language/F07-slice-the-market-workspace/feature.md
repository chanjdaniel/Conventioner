---
id: E16/F07
title: Slice: the market workspace
type: feature
status: in-progress
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

## Done

The largest slice: 36 files across the plan editor, the four tabs, Tables, Vendors, Attendance,
the phase rail, the placement dialog, the vendor drawer and every `Element*` and `application/*`
component. Product-wide backlog 902 -> 226, and the rules are errors for all of them.

This is where the two design languages actually met, so it is where most of the legacy idiom went:

- **Every hand-rolled elevation became `--shadow-card`.** The halo (`0 0 4px 5px`), its inset twin,
  `0px -1.5px 5px 1.5px var(--hover-grey)`, a three-layer shadow written out longhand in two files,
  and five one-offs besides.
- **The inset "pressed" shadow is gone from the setup fields**, which is what made them look
  skeuomorphic beside the flat cards on the next tab.
- **Focus rings drawn as box-shadows became real outlines**, matching the primitives.
- **`50%` is no longer a violation.** A circle is not a scale value, and no radius token can
  express one - the rule was asking for something that does not exist.

One colour is deliberately kept and marked: **`#5865f2` on "Send to Discord"** is Discord's own
brand colour. A button that posts to Discord wearing Conventioner's green would say the wrong thing
about where the message goes, so it carries a `stylelint-disable-next-line` with that reason rather
than being quietly retoned.
