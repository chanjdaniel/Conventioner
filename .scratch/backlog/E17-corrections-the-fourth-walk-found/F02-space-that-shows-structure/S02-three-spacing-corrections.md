---
id: E17/F02/S02
title: Three spacing corrections that each stand alone
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

Three unrelated spacing faults, each on its own screen, grouped into one story because each is far too small to be worth its own context.
They share no code and can be verified independently.

**1. The sign-in code form's two inputs stop overlapping.**
On the organizer sign-in screen, after requesting a code, the email input and the six-digit code input are stacked too closely: focusing the code input draws its focus ring into the email input above it.
There must be enough space between them that neither field's focus ring touches its neighbour.

**2. The settings panel gets an outer gutter.**
On the market workspace, the white panel holding the tab bar, the phase rail and the plan cards runs flush to the page on the left, the right and the bottom.
It should read as a card sitting on the page rather than as the page itself.
Top is deliberately out of scope - the panel meets the top bar above it.

**3. The phase rail's current step stops crowding its label.**
The current phase's dot is filled and ringed, which makes it visually larger than every other dot on the rail - but the space between dot and label does not grow with it, so the ring sits almost against the text.
The ring is drawn as an outline with an offset, and **an outline paints outside the border box without taking part in layout**, so it consumes 4px of the 6px gap and leaves about 2px visible.

## Acceptance criteria

- [ ] On the sign-in code form, focusing the six-digit code input leaves visible space between its focus ring and the email input's box. Verify by screenshot with the code field focused.
- [ ] The settings panel has a gutter on its left, right and bottom, taken from a spacing token rather than a literal, and it applies on every tab.
- [ ] The phase rail's gap grows by the ring's full extent on the **current step only**; the ordinary steps keep the gap they have today, which the walk found no fault with.
- [ ] The current step's ring does not crowd the divider to its left - the rail's steps are separated by a border and padding, so check both sides of the ringed dot.
- [ ] All three are verified by screenshot at 1920x1080, before and after, quoted in the PR.
- [ ] `npm run lint:css` passes.

## Note for whoever implements

The settings panel this story adds a gutter to is replaced by [E18](../../E18-the-workspace-follows-the-phase/epic.md)'s full-width ordered page.
That is known and accepted: this is a one-line fix on the surface the product serves today, and this epic ships first.
