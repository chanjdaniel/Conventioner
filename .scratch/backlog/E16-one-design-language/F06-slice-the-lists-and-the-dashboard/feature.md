---
id: E16/F06
title: Slice: the lists and the dashboard
type: feature
status: blocked
blocked_by: [E16/F04]
pr: []
---

## Outcome

Markets, Organizations, the dashboard and the two management dialogs are on the design language.

## Scope

`MarketsView`, `OrganizationsView`, `DashboardView`, `SummaryCard`, `ManageMarketOverlay`, `ManageOrgOverlay`, `NewMarketOverlay`.

Carries the `Manage` button that is outline-white on one screen and solid-dark on the next, the new-market dialog whose two adjacent fields use two shapes and two typefaces with one label centred and one left-aligned, and the 320px name cell inside an 1840px row.

It does **not** decide what a market row's button should do, or what the dashboard is for. Those are open questions for a later map; this slice restyles what is there.

## Done means

- Every control on these screens comes from a primitive; no local height, padding, radius or shadow.
- Type and spacing on these screens are on the scale in `docs/design-system.md`.
- Stylelint's rules are flipped from warning to **error** for these files (`E16/F02/S02`).
- The contrast sweep covers these screens, including their dialogs and empty states.
- A before/after screenshot pair is attached to the PR, because this is the kind of change a diff does not show.
