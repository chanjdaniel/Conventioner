---
id: E18/F04/S02
title: The application chip
type: story
status: done
blocked_by: [E18/F04/S01]
pr: []
---

## What to build

A form-intake market's phase rail carries a small control that **copies** its public application URL and **opens** the page.

An organizer can send the link to vendors, and can see exactly what a visitor sees, at any point in the market's life.

A CSV market shows no chip at all.

## The pattern to follow, and the one rule not to copy

The rail already has a check-in chip: a label, the URL as a link, and a copy control that confirms for a couple of seconds.
This is that control, not a new idea.

**Its visibility rule is the opposite, deliberately.**
The check-in chip appears in one phase only, because before that its link would be a 404.
This chip appears in **every** phase of a form-intake market, because the apply page already has a real answer in every phase - it renders a phase badge and says the market is not currently open.
That is the whole point: the organizer can check what a visitor gets before opening, while open, and after closing.

## Acceptance criteria

- [ ] A form-intake market's rail shows the chip in every phase, including draft and archived.
- [ ] The chip copies the URL and confirms it copied; it also opens the page.
- [ ] A CSV market shows no chip, on any phase.
- [ ] The apply page is verified by an organizer following the chip in three phases - before applications open, while open, and after they close - and each renders a sensible page, not an error and not an empty form.
- [ ] The chip does not disturb the rail's height or its behaviour at the narrower supported widths; the rail's existing height at the workspace's named widths is checked before and after.
- [ ] The check-in chip's own rule is unchanged.
- [ ] Verified end-to-end for both intake modes.
