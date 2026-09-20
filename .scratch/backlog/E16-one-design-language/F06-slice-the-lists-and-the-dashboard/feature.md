---
id: E16/F06
title: Slice: the lists and the dashboard
type: feature
status: in-progress
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

## Done

Nine files, 184 warnings to zero, and the rules are errors for them now. Product-wide 1082 -> 902,
though part of that drop was a bug in the gate itself rather than migration (see below).

Two decisions worth recording, because neither was mechanical:

- **Eight phase colours became four chip tones.** `PhaseBadge` painted a bespoke solid fill per
  phase - `#a46a07`, `#8558ec`, `#048197`, `#cd3f85` and four more, none of them in `base.css`.
  A chip's colour now carries the state's CHARACTER and its label carries the state's identity:
  neutral (draft, archived), informational (applications open/closed), attention (review,
  assignment, offers), positive (market days). **The tradeoff is real and is written into the
  component**: five phases no longer have five distinct colours on the markets list, where the
  phase is what tells rows apart. If that turns out to be load-bearing it is a follow-up, not a
  reason to keep eight untokenised fills.
- **Four role tints became three.** Owner reads as informational, Admin and Editor as positive
  (they can change things), Viewer as neutral (they cannot). Two of the four - a purple `#7b1fa2`
  and an amber `#f57c00` - were the only instances of their hue anywhere in the product.

**`--mm-text-green` was added to the palette**, for the same reason `--mm-text-yellow` exists:
`--mm-green` is 4.59 on white but only 3.75 on its own 16% tint, so a positive chip cannot reuse
it. The value was already in the tree as a literal I had introduced in `E16/F01`; it is a token now.

**A bug in the gate, found by using it.** The `box-shadow` rule read `/^(?!var\(|none)/` only after
this slice; it had been `/^(?!var\().(?!none)/`, which consumes a character before looking ahead, so
every `box-shadow: none` in the product was reported as a violation. Roughly 170 of the 1082
warnings were that. A gate nobody can satisfy is a gate that gets switched off.
