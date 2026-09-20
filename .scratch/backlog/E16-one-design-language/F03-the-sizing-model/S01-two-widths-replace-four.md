---
id: E16/F03/S01
title: Two widths replace four
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

The product has four page widths and four gutters:

| Screen | Content width | Gutter |
| --- | --- | --- |
| Market Setup and its tabs | 1536 (`width: 80%`) | 192 |
| Tables, Vendors, Attendance | 1100 | 410 |
| Markets, Organizations | 1840 | 40 |
| Import applications | 1854 | 32 |

Replace them with the two tokens in `docs/design-system.md`:

```
--workspace-max: 1440px   /* Market Setup and its four tabs */
--list-max:      1100px   /* Tables, Vendors, Attendance, Markets, Organizations */
```

A screen is a card of one of those widths, centred, with one gutter value, that **grows to its content**. `width: 80%` on `.market-setup-body` goes with it.

Two things to expect and not mistake for bugs:

- **Markets and Organizations become visibly narrower**, from 1840 to 1100. This is deliberate and it is most of why finding O2 - a 320px name cell stranded in an 1840px row - stops mattering.
- **The rail still wraps on the `--list-max` screens.** That is [ticket 07](../../../wayfinding/claims-and-room/issues/07-the-rails-second-row.md), not this story, and it may yet amend `--list-max`. Do not try to fix it here, and do not pick a third width to dodge it.

The import wizard is not in either list. It is the one screen whose chrome is an open question; leave its width alone until `E16/F08`.

## Acceptance criteria

- [x] Exactly two content widths exist across the organizer screens, from the two tokens. No screen sets its own.
- [x] No organizer screen sets `height` as a percentage of the viewport.
- [x] The gutter is one value.
- [x] An e2e assertion reads the rendered content width of each organizer screen and matches it to the token its screen belongs to, so a fifth width cannot be added quietly.

## Notes

Startable now. `S02` and `S03` are the same screen and will conflict in the same files; take them in order or in one PR.
