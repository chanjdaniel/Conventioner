---
id: E10/F04/S02
title: The publish dialog says what publishing does
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

The `market_days` confirmation currently reads **"Begin Market Days? No offers are pending - no
vendors will be marked refused"**, fetched from `/markets/<id>/pending-offers-count`.
Offers are out of scope for MVP, so that count is always 0 and the dialog always answers a question
the organizer has never asked.

It should say that a **public check-in page goes live** - the thing that actually happens, and the
thing the organizer cannot take back.

The dialog's title, the button that opens it and the button that confirms it currently read
"Publish Market", "Begin Market Days" and "Begin Market Days".
One name.

## Acceptance criteria

- [ ] The dialog names the consequence: a public check-in page starts serving.
- [ ] One verb across the opening button, the dialog title and the confirm button.
- [ ] The confirm button is not styled as destructive; publishing is a forward step.
- [ ] The pending-offers fetch is removed from this path, or retained only where offers exist.
