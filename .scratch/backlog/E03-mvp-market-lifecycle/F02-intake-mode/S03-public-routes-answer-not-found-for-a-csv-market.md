---
id: E03/F02/S03
title: A stranger visiting a CSV market's public pages is told nothing
type: story
status: ready
blocked_by: [E03/F02/S02]
pr: []
---

## What to build

A stranger who opens any of the four public applicant pages of a CSV market sees exactly what they would see for a slug that belongs to no market at all.

The four are the market home page at the bare slug, the application page, the applicant login page, and the applicant dashboard.
The market home page currently prints the slug back and asks the back end nothing, so it learns its market through the same gated surface as its siblings.

A vendor opening the check-in page for that same market is unaffected and checks in as before.

What an unknown slug renders today is the baseline this matches.
Designing a public market landing page is out of scope: MVP never serves that route to anyone.

## Acceptance criteria

- [ ] Each of the four public applicant routes renders the not-found state for a published CSV market
- [ ] That state is the same one an unknown slug produces; the two are asserted to be identical rather than each asserted separately
- [ ] The market home route no longer renders the slug stub for a market it cannot serve
- [ ] The check-in route for the same market is unaffected
- [ ] No page tells the visitor that the market exists but is not taking applications
- [ ] An e2e story walks a stranger through a CSV market's applicant routes and then through its check-in route, against one seeded market

## Notes

There is no catch-all route and no shared not-found view in the front end today; an unknown slug surfaces as an inline error on the page that asked for it.
Whether that baseline is worth improving is a separate question from this story, which only has to make a gated market indistinguishable from an absent one.
Improving it for both cases at once is acceptable; improving it for only one is not, because the whole point is that they match.
