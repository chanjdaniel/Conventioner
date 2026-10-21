---
layer: implementation
kind: module
describes:
  - front-end/src/stores/market.ts
  - front-end/src/utils/openMarket.ts
  - front-end/src/utils/lastMarket.ts
verified: 2026-10-21
sources:
  - wayfinding/the-market-frame/03
  - wayfinding/claims-and-room/02
  - E21/F02/S01
  - E21/F02/S05
  - E21/F02
  - E21/F02/S04
---

# The market store

[`front-end/src/stores/market.ts`](../../../front-end/src/stores/market.ts) is the one holder of a market in the browser: the open market, exactly as the server last reported it.
Every market screen, the phase rail and every tab read it; nothing else keeps a copy.
The rules it keeps for all code are [one market, from the server](../conventions/one-market-from-the-server.md); this node is how it does it.

## Interface

- `open(id)` opens a market by id, or re-reads it when it is the one already open.
  Opening another id drops what was held for the old one at once.
- `refresh()` re-reads the open market with `GET /markets/:id` and takes what it says.
  Every write that changes the market is followed by a call to it; it is also the retry after a failed arrival.
- `clear()` forgets the market entirely; signing out calls it, so one account is never shown another's market.
- `market` is the held market, and only while its id is the open id; `status` is `idle`, `loading`, `loaded`, `failed` or `missing`; `stale` is true when the last re-read failed in transit.

Screens do not call the store directly: [`useOpenMarket`](../../../front-end/src/utils/openMarket.ts) takes the route's market id, opens the market on arrival and whenever the id changes, re-reads it when the organizer comes back to the browser tab (`visibilitychange`), and returns `{ market, status, refresh }`.
Every view routed by market id uses it, and hands the market to [the market frame](market-frame.md).

## Sharp edges

**Keyed by the route's id.**
A market held for one id is never shown while another is open, not even for a frame, and an answer to a fetch that a later fetch has overtaken is dropped (a generation counter).

**What it holds is shown while a re-read of the same market is in flight**, so returning to a screen or saving does not blank it.
Only an arrival with nothing held shows `loading`.

**A missing market and one the organizer cannot reach read identically.**
A 404 and a 403 both drop what is held and set `missing`; telling them apart would confirm to anyone guessing ids that a market is real.
Any other failure is `failed` when nothing is held, and a failed re-read keeps the held market and marks it `stale`, so a dropped connection never unmounts a screen's unsaved work.

**The dashboard's pointer is set here and nowhere else.**
[`front-end/src/utils/lastMarket.ts`](../../../front-end/src/utils/lastMarket.ts) keeps `lastMarketId` in `localStorage`: a pointer for "continue where you left off", never a copy.
The store sets it when a market arrives, by whatever route, and forgets it when that market comes back missing.
Every access to storage may fail quietly, since losing the pointer costs only a convenience.

**The rail never fails a screen that cannot load one.**
The frame draws the rail only once a market is in hand, so a market that will not load shows the frame's own arrival states and nothing that depends on it.

## Why

The market used to be held three ways at once (a view's ref, a value one tab published for its siblings, and `localStorage`), written by eleven call sites that each patched their own copy.
That is how the form builder ignored a phase change until the organizer left the tab.
The decision is [ADR 0009](../../adr/0009-the-back-end-is-the-only-source-of-truth.md).

The glossary concept it serves: [Market](../../business/concepts/market.md).
