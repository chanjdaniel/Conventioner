---
id: E03/F02/S04
title: Publishing lands the organizer on a page their market serves
type: story
status: ready
blocked_by: [E03/F02/S03]
pr: []
---

## What to build

An organizer who finishes assignment and clicks Done publishes their market and is taken to its
public page.

Since F02/S03, that is a dead end for a CSV market: Done navigates to the market's bare slug, and
a CSV market answers there exactly as a market that does not exist. The organizer's reward for
publishing is a page telling them their own market cannot be found.

The destination should be the public page the market actually serves. For a CSV market that is its
check-in URL, which is the link the organizer needs to share on the day anyway. For a form market
it stays the market home.

## Acceptance criteria

- [ ] Publishing a CSV market lands the organizer on a page that renders, not on not-found
- [ ] Publishing a form market still lands on the market home
- [ ] The destination is decided from the market's intake mode, not guessed from the phase
- [ ] A market whose slug cannot be derived still falls back as it does today
- [ ] An e2e story publishes a market and asserts the organizer can read the page they land on

## Notes

Found while implementing F02/S03, which introduced the regression.
The market document already carries `intakeMode` as of F02/S01, and the raw-document endpoints
stamp it, so the front end has the value without a new request.
