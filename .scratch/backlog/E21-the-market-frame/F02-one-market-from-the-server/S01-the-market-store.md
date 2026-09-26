---
id: E21/F02/S01
title: The market store, proved by Tables and Attendance
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

One place that holds the open market as the server last reported it, and the two screens that are already addressed by id reading it.

An organizer on Tables or Attendance sees the market's name and phase rail as the server has them. Moving between those screens and back does not flash an empty rail. Switching to another browser tab, changing the market there, and coming back shows the change without a reload.

The store is keyed by the route's market id. It fetches on every arrival at a market screen and again on `visibilitychange` to visible. It shows what it holds only while that fetch is in flight, and never shows a market held for a different id.
After any write that changes the market it re-fetches rather than being patched; on these two screens that write is a transition fired from the rail.

`useRailMarket` becomes a thin reader of the store rather than a fetcher of its own.

## Arrival states

- **Loading**: a hard reload draws the screen's frame with a loading state inside it.
- **Failed**: a fetch that fails offers a retry.
- **Missing or unreachable**: a market that does not exist and one the organizer cannot reach read identically.
- **Signing out** clears the store, so one account is never shown another's market.

## Acceptance criteria

- [ ] A single Pinia store holds the open market, keyed by id, and Tables and Attendance read their market and rail from it.
- [ ] It fetches on arrival and on returning to the browser tab; a transition from the rail is followed by a re-fetch, not a local merge.
- [ ] Navigating from market A's Tables to market B's Tables never shows A's name or phase, not even for a frame.
- [ ] Loading, failed-with-retry, and missing-or-unreachable states render as above, and missing and unreachable are indistinguishable.
- [ ] Signing out and in as another user never shows the previous user's market.
- [ ] Unit tests cover the store's keying, re-fetch-after-write and stale-id rules; an e2e spec covers the return-to-tab re-fetch on Tables.
