---
id: E10/F01/S02
title: The check-in URL is on the rail
type: story
status: done
blocked_by: []
pr: [73]
---

## What to build

Publishing a market puts a public check-in page on the air at `/<slug>/check-in`, and **nothing in
the product has ever told the organizer that URL exists**.
After the transition the screen is unchanged except that the phase pill reads "Market Days".
The organizer has to know the slug rule and type it.

A published market's rail carries a **check-in URL chip** between the spine and the forward action:
the URL, and a control that copies it.

## Acceptance criteria

- [x] A market in `market_days` shows its check-in URL on the rail.
- [x] The URL can be copied in one action.
- [x] A market not yet published shows no chip - it would be a link to a 404.
- [x] With a 60+ character URL at 1920x1080, the chip does not push the spine into overlap.

## Notes

Two adjacent facts, neither of which this story changes:

- **`/<slug>` without `/check-in` answers "Page not found"** for a live CSV-intake market. That is
  the intake-mode gate working as designed, and it is deliberate - a gated market answers as a
  nonexistent one does. But a vendor who trims the path off the URL they were handed is told the
  market does not exist, and door staff will do that. Worth knowing when writing the copy around
  the chip.
- **The check-in page does not name the market until after a lookup.** `E09/F07/S01`.
