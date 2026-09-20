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
      The count comes from `GET /markets`. A fresh browser context is exactly the "never opened one"
      case, which is why `dashboard-market-count.spec.ts` reproduces it by simply signing in.
- [x] An organizer who genuinely owns none still gets the welcome and the "set up your first market" action - that copy is good and should survive.
      Unchanged, and now reached only when the server says zero.
- [x] The "last market opened" convenience keeps working where the cache has one.
      Better than before: the cache supplies the market *id*, and the card is drawn from the server's
      answer, so a market renamed on another device no longer reads back here under its old name.

## Notes

Finding F1 in `.lavish/qc-2026-09-20.html`.

Deliberately *not* part of map ticket 02 (source of truth for the market a screen is showing).
That ticket is about a screen displaying one market's state; this is about the account's market *count*, which no screen caches and no decision governs.
If ticket 02 lands first and makes fetching uniform, this gets easier, but it does not wait on it.

## Notes on the shape

`localStorage` is still read, and should be: which market this browser last opened is a fact about
the browser, and nothing else records it.
What moved to the server is the *account's* market count, which the cache was never able to answer.

Four states, because they are four different truths and three of them were previously collapsed:
the remembered market (drawn fresh from the server), a remembered market that has since been
deleted, markets owned but none opened here, and genuinely none.

A failed request is a fifth case, and it renders no claim at all - answering "you have none" when
the question could not be asked is the same falsehood by a different road.
