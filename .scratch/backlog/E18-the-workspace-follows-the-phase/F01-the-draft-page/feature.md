---
id: E18/F01
title: The draft page
type: feature
status: done
blocked_by: []
pr: []
---

## Outcome

A draft market is one scrolling page whose sections run in the order the work actually happens: the plan first, then the application form that is built from it.

## Why now

The back end already states the dependency - the form's offering "is never an independent list: it is the market plan itself" - and the workspace inverts it, putting the Application Form tab to the left of Market Setup.

The plan cards are also too small for what they hold, and that is documented in the source rather than merely felt: equal thirds once gave the widest card the same width as the narrowest, and the consequence was the tier select rendering too narrow to show any of its own values, on the field that sets a vendor's price.
The current split is a negotiated truce.
Full-width sections end the contention rather than rebalancing it.

Settled in [ticket 02](../../../wayfinding/the-order-of-the-work/issues/02-what-the-draft-workspace-looks-like.md).

## Not a wizard

The surface must be resumable and must never force a walk-through to change one value later, which rules out step navigation.
An ordered page communicates order by position instead.
It also survives into later phases unchanged, so there is one layout for this data rather than two.

## Stories

- `S01` - the draft page.
- `S02` - market dates is a calendar.
