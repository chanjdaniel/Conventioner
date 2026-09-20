---
id: E14/F01/S02
title: The dashboard asks the server whether you have a market
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

Sign in on a browser that has not opened a market before and the first screen says **"You have not set up a market yet"**, with a button offering to make one - while `GET /markets` returns the market you already own.
It survives a hard reload.

`DashboardView.vue` derives the empty state from `localStorage.getItem('market')` - the last market opened *in this browser* - rather than from whether the account has any.
A new browser, a second device, or cleared site data all produce it.
The statement is false and the offered action invites a duplicate instead of opening what they have.

Ask the server. The dashboard already has the session.

## Acceptance criteria

- [x] An organizer who owns a market is never told they have none, on any browser.
      The count comes from `GET /markets`.
      A fresh browser context is exactly the "never opened one" case, which is why
      `dashboard-market-count.spec.ts` reproduces it by simply signing in.
- [x] An organizer who genuinely owns none still gets the welcome and the "set up your first market" action - that copy is good and should survive.
      Unchanged, and now reached only when the server says zero AND this browser never opened one.
- [x] The "last market opened" convenience keeps working where the cache has one.
      Better than before: the card is drawn from the server's answer, so a market renamed on another
      device no longer reads back here under its old name.
      Where the server cannot be reached the cached copy still draws the card, because it never
      needed the network and losing it would trade one regression for another.

## Notes

Finding F1 in `.lavish/qc-2026-09-20.html`.

Deliberately *not* part of map ticket 02 (source of truth for the market a screen is showing).
That ticket is about a screen displaying one market's state; this is about the account's market *count*, which no screen caches and no decision governs.
If ticket 02 lands first and makes fetching uniform, this gets easier, but it does not wait on it.

## Notes on the shape

`localStorage` is still read, and should be.
Which market this browser last opened is a fact about the browser, and nothing else records it.
What moved to the server is the market *count*, which the cache was never able to answer.

Four states, because they are four different truths and three of them were previously collapsed:
the remembered market, a remembered market that has since been deleted, markets reachable but none
opened here, and none at all.
The deleted case splits again on whether any others survive, because "set up your first market" is
false for someone who had one - the same falsehood this story removes, worn the other way round.

A failed request is a fifth case.
It makes no claim about the count, because answering "you have none" when the question could not be
asked is the same falsehood by a different road.
It still draws the remembered card, because that never depended on the request.

The copy says markets are "open to you" rather than owned.
`GET /markets` answers what the account can reach, which includes markets reached through an
organization as a viewer.
