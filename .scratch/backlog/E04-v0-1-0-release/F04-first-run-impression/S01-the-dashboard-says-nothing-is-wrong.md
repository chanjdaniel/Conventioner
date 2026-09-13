---
id: E04/F04/S01
title: A new organizer's dashboard does not report a missing market
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

An organizer who has just signed in for the first time sees an invitation to begin, not a greyed
card reading **"Last market not found"**.

## What is known

The dashboard has a "Previously opened" card. When no market has been opened it falls to a disabled
card whose text is "Last market not found" (`front-end/src/views/DashboardView.vue`).

Two different situations produce it, and only one is an error:

- The organizer has never opened a market. Nothing is wrong, and nothing is missing.
- A market that *was* opened is no longer reachable: deleted, or access revoked. Something did go
  away.

The current text answers as though the second is always the case. For everyone's first sign-in - the
very first screen of the product - it reports a failure where the truth is "you have not started
yet".

Found while walking `docs/STARTUP.md` from a clean clone for E04/F02/S01; the screenshot is the
first post-login screen a brand-new verified user gets.

## Acceptance criteria

- [ ] A user who has never opened a market sees wording that invites them to begin, and the card
      does not read as an error
- [ ] The genuinely-missing case is still distinguishable, rather than both collapsing into one
      cheerful message
- [ ] The "Previously opened" heading is not shown above a card for someone who has opened nothing
- [ ] Covered by a test at the level the behaviour lives at

## Notes

Deliberately not the same thing as seed or demo data, which the v0.1.0 wayfinding map rules out of
scope. This is about what the empty state *says*, not about manufacturing content to fill it.
