---
id: E16/F04
title: The primitives
type: feature
status: in-progress
blocked_by: [E16/F02, E16/F03]
pr: []
---

## Outcome

`.btn`, `.field` and `.chip` exist and own height, padding, radius, type, focus and the disabled state. Nothing has migrated onto them yet.

## Why now, and why after F03

Tokens cannot fix what is actually wrong. A `--radius-control` does not stop a file writing `height: 45px`, and that is where the damage is concentrated: **five control heights on the login screen, ten on Market Setup**, four disabled treatments, two designs for the same `Manage` button, a 25px-tall `Remove` button beside 34px peers.

This used to be blocked on [claims-and-room ticket 01](../../../wayfinding/claims-and-room/issues/01-how-an-organizer-screen-sizes-itself.md), which is resolved as of 2026-09-20. The dependency survives as `E16/F03`, for the same reason it existed: **a `.field` has to be wide enough for its own content**, and the Tier select is 65px only because the plan's columns are equal thirds. Judging a control primitive against a layout that is about to be rebuilt is how you get primitives that fit nothing.

## What the primitives must cover

Drawn from what the walk actually found, so the first migration does not immediately need a fourth primitive.

- **`.btn`** - primary, secondary, destructive, and **one** disabled state. The product has four disabled treatments today, one of which renders white text at 1.74:1.
- **`.field`** - input, select and textarea, left-aligned. 18 of 27 controls on Market Setup are centre-aligned text, which is why a column of dates is hard to scan.
- **`.chip`** - status badges. Six treatments today across pill/rect, solid/tint, uppercase/sentence.

Non-interactive labels must not be reachable through `.field`.

## Stories

- `S01` - the button primitive.
- `S02` - the field primitive.
- `S03` - the chip primitive.

All three landed together in `front-end/src/assets/primitives.css`, because they share the height, the radius, the focus ring and the disabled state - splitting them across three commits would have meant deciding those three times.

**The reference is a test, not a demo page.** The story asked for "a rendered example page or story book entry, so the slices have something to check against". `src/__tests__/primitives.test.ts` serves that purpose and is better suited: a demo page is product surface nobody ships and nothing keeps honest, while a test fails when the contract drifts. It asserts the things tokens cannot express - two control heights and no third, one disabled state, fields left-aligned, a select that cannot be squeezed below its longest option, and a focus ring that is not the brand green.

The four slice features that follow get their stories written when a slice is taken. A story that says "use the primitive" is not a story; what each slice needs is the list of what it actually holds.
