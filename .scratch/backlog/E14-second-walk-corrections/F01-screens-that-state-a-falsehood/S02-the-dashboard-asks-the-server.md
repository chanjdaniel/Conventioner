---
id: E14/F01/S02
title: The dashboard asks the server whether you have a market
type: story
status: ready
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

- [ ] An organizer who owns a market is never told they have none, on any browser.
- [ ] An organizer who genuinely owns none still gets the welcome and the "set up your first market" action - that copy is good and should survive.
- [ ] The "last market opened" convenience keeps working where the cache has one.

## Notes

Finding F1 in `.lavish/qc-2026-09-20.html`.

Deliberately *not* part of map ticket 02 (source of truth for the market a screen is showing).
That ticket is about a screen displaying one market's state; this is about the account's market *count*, which no screen caches and no decision governs.
If ticket 02 lands first and makes fetching uniform, this gets easier, but it does not wait on it.
