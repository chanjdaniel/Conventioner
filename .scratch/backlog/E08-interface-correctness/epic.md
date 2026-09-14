---
id: E08
title: Interface correctness
type: epic
status: ready
blocked_by: []
pr: []
---

## Outcome

The organizer can read what the product tells them, at the window size they actually use, without
meeting a control that lies about what it does.

## Why now

A full journey walk on 2026-09-14 (`.lavish/mvp-findings.html`) found the payoff screen unreadable
at the most common laptop resolutions and roughly fifteen first-contact defects around it.
None of them carries a decision, which is why they are here and not on
[Map: Real-market readiness](../../wayfinding/real-market-readiness/map.md).

The one finding that *does* carry a decision - the red "Archive Market" button that publishes a
market - is on that map as ticket 06, because `archived` currently means both "finished" and "just
went live". Do not rename it here.
