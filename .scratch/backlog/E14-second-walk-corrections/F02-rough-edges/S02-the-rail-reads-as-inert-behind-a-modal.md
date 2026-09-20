---
id: E14/F02/S02
title: The rail reads as inert behind a modal
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

With the vendor detail drawer open, `.detail-overlay--open` intercepts pointer events across the whole page, the phase rail included.
"Publish Market" keeps its full green and looks live; clicking it closes the drawer instead of publishing.

Correct modal behaviour, wrong affordance.
Make the rail look as inert as it is while a drawer or dialog is open.

## Acceptance criteria

- [x] While a modal overlay is open, no control behind it presents itself as available.
      Not by restyling: see below.
      The page behind the drawer is now `inert`, so it is out of the tab order as well as out of
      reach of the mouse.
- [x] Closing the overlay restores the rail's normal appearance.
      Nothing about its appearance changed, so there was nothing to restore; what is restored is
      its reachability, and the e2e asserts the rail takes focus again after the scrim dismisses.
- [x] The scrim still closes the drawer on click - that behaviour is right and stays.
      Pinned by the same e2e, and by a unit test that the modal's own parts are never marked.

## Notes

Finding F13 in `.lavish/qc-2026-09-20.html`.

## The reported symptom did not reproduce

> "Publish Market" keeps its full green and looks live.

It does not.
The scrim is `rgba(0, 0, 0, 0.4)` over everything behind it, and sampling the rendered pixels with
the drawer open and closed shows a uniform 60%: page background `246 -> 148`, card white
`255 -> 153`, the Back button's green scaled by the same factor.
The rail is dimmed exactly as much as every other control on the page, which is what a modal scrim
is supposed to do.

So there was nothing to restyle, and restyling would have made the rail *more* conspicuous than its
neighbours rather than less.

## What was actually wrong

The drawer declares `role="dialog"` and `aria-modal="true"`, which tells assistive technology that
everything outside it is out of play.
That was not true.
Fourteen controls behind it stayed in the tab order, the rail's forward action among them, so a
keyboard user could tab onto "Publish Market" and press Enter with a vendor's details open.

A control you can focus and fire presents itself as available far more strongly than a dimmed one
does, so this is the same acceptance criterion, met at the layer where it was actually failing.

## Why a shared composable

`front-end/src/utils/useInertBehind.ts` walks up from the modal's own parts and marks every sibling
along the way.
Marking a single container is not enough, and the first attempt proved it: `inert` on
`.vendors-card` trapped two tabs and let the third reach the app header's nav button, which is in a
different branch entirely.

`inert` rather than `aria-hidden`, which hides a control from a screen reader while leaving it
clickable and focusable - the same lie in a different accent.

## Not done here

Every other modal in the app has the same defect: `PlacementDialog`, `ManageMarketOverlay`,
`ManageOrgOverlay`, `NewMarketOverlay`, and the phase rail's own confirmation.
The composable is written to be reused by all of them, but adopting it in each is a sibling story
rather than a widening of this one.
