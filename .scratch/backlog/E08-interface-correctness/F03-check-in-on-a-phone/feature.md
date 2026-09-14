---
id: E08/F03
title: Check-in works on a phone
type: feature
status: done
blocked_by: []
pr: [2923d27c]
---

## Outcome

The public check-in page is usable and looks right on a phone, as well as on the laptop it is
normally run from.

## Why now

Check-in is laptop-primary in practice, but it is the one surface someone may hold in their hand at
a door, and it is the last step of the journey. Today at 390x844 the page has 625px of horizontal
overflow and a fixed-width layout.

This is the **only** carve-out from the desktop-only stance settled on
[Map: Real-market readiness](../../wayfinding/real-market-readiness/map.md). Nothing else needs to
work below laptop widths; do not widen this feature into a general responsive pass.

## Acceptance criteria

- [x] The check-in page has no horizontal overflow at 390x844.
- [x] Email entry, lookup, the assignment card and the check-in action are all reachable and legible one-handed.
- [x] The laptop rendering is unchanged or better.
