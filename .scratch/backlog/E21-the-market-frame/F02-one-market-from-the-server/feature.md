---
id: E21/F02
title: One market, from the server
type: feature
status: done
blocked_by: []
pr: []
---

## Outcome

Every market screen shows the market exactly as the server last reported it.
A phase change, a form save or an assignment run shows up on every surface at once, returning to the browser tab picks up what changed, and nothing about a market is kept in the browser.

## Why now

The form builder ignores an open, close or reopen until the organizer leaves the tab and comes back, and in the reopen direction its lock notice names a phase the rail directly above it contradicts.
The same cause hides the market's own questions from the priority rules on the Assignment tab unless the form tab happened to be opened first on that visit, which quietly removes a solver input.
Both were reproduced end to end.

Underneath both is a market held in three places (a view ref, a sibling tab's published value and `localStorage`) and written by eleven call sites that each patch their own copy.
The organizer asked for the back end to be the only source of truth.

Settled in [the-market-frame ticket 03](../../../wayfinding/the-market-frame/issues/03-one-market-every-surface-reads.md); read it and [02](../../../wayfinding/the-market-frame/issues/02-which-surfaces-go-stale.md) before taking any story.

## What is already settled, and must not be re-litigated

- Every market screen is addressed by id: `/markets/:marketId/...`. The id-less paths send the organizer to the Markets list.
- One Pinia store holds the open market. It fetches on every arrival and on returning to the browser tab, and shows what it holds only while that fetch is in flight, and only for the same id.
- After any write that changes the market, the store re-fetches it. Nothing patches the held market locally.
- An editor's unsaved work is the editor's working copy, never layered on the store, and a re-fetch never touches it.
- The form lock is carried on `GET /markets/:id`, computed server-side.
- Nothing about a market is stored in the browser, except the dashboard's `lastMarketId` pointer.
- No compatibility layer for e2e specs that seed through `localStorage`.

## Stories

- `S01` - the market store, proved by Tables and Attendance.
- `S02` - Market Setup is addressed by id and reads the store.
- `S03` - the form lock is on the market.
- `S04` - Vendors, Import and the floorplan editor are addressed by id.
- `S05` - nothing about a market is stored in the browser.
