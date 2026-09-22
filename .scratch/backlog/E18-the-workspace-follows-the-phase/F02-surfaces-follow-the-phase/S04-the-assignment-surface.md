---
id: E18/F02/S04
title: The assignment surface
type: story
status: ready
blocked_by: [E18/F02/S02]
pr: []
---

## What to build

Assignment Priority, Assignment Options and the Assign action leave the plan and live on the surface for the phase where they work.

An organizer setting up a draft market no longer sees a disabled Assign button and a refusal message beside their dates.

## Why they were in the wrong place

A priority rule names a form field key or a built-in application attribute, so it cannot be written before the form exists, and it is most meaningful once applications are in hand.
Both cards sat in the earliest stage - the furthest possible point from where they belong.

Assign is already refused outside the assignment phase by the back end, and the front end already mirrors that refusal.
Showing the button everywhere meant explaining a rule on every screen instead of applying it on one.

## Acceptance criteria

- [ ] Assignment Priority, Assignment Options and Assign appear on the assignment surface and nowhere else.
- [ ] The plan no longer renders either card, and the disabled Assign button and its refusal message are gone from the plan entirely.
- [ ] Assign remains enabled only when the required assignment options are set; that existing condition is preserved, not reimplemented.
- [ ] The back end's refusal outside the assignment phase is untouched - it stays the authority, and a hidden button is not a rule.
- [ ] Both cards still autosave into the plan object exactly as they do today; moving where they render must not change where they are stored.
- [ ] The assignment results this surface leads to are unchanged by this story.
- [ ] The existing unit tests covering assignment options and assignment priority pass, adjusted only for where the components are mounted.
- [ ] Verified end-to-end: a market walked to the assignment phase can set priority and options and run Assign from this surface.
