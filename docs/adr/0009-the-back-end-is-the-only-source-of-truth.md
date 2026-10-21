---
layer: implementation
kind: adr
verified: 2026-10-21
sources:
  - wayfinding/the-market-frame/map
  - wayfinding/the-market-frame/02
  - wayfinding/the-market-frame/03
  - wayfinding/claims-and-room/02
  - E21/F02
status: accepted
---

# The back end is the only source of truth about a market

The glossary concept: [Market](../business/concepts/market.md).

## Context

The browser held the market three ways at once: a view's ref, a value one tab published for its siblings, and the whole market in `localStorage` under `market`.
Eleven call sites wrote it, each patching its own copy, and five screens read it, some trusting it over the server because they never fetched.
The form builder ignored a phase change until the organizer left the tab, the priority rules read "your questions" from a value the form tab published rather than from the stored form, and a stale copy was sent back to the server and overwrote what the server knew.
Each was fixed alone, and the next screen added re-created the class.

## Decision

The browser keeps no second copy of a market.
One store, [the market store](../implementation/modules/market-store.md), holds the open market exactly as the server last reported it, keyed by the market id in the URL; every market screen, the phase rail and every tab read it.
It fetches on every arrival at a market screen and when the organizer returns to the browser tab, and re-reads after every write; nothing patches it.
An editor's unsaved work is the editor's own working copy, never layered on the store.
Facts derived from the market (its locks, the verdict on each move, the phase record) are computed by the server and served on the market.
The rules all code follows are [one market, from the server](../implementation/conventions/one-market-from-the-server.md), and every market page is addressed by id ([every market page has an address](../implementation/conventions/every-market-page-has-an-address.md)).

## Consequences

- Every write costs a second request, the re-read, and every arrival at a market screen waits for the server: a reload shows the frame's loading state, never a remembered market.
- No caller needs to know which fields its write touched, and a field the server adds reaches every screen without a change to any of them.
- A screen open in two browser tabs is current the moment its tab is shown again; live push is not needed for that, and is not built.
  What the screens follow at once is a change made in this browser tab; another organizer's change reaches a screen at its next arrival or return, and two people editing one market at once is not handled.
- The dashboard's "continue where you left off" is a pointer (`lastMarketId`), forgotten silently when that market is gone.
- A rule about the market lives once, on the server; a front-end copy of a judgement (a role threshold, a move's verdict, the form lock) is drift by construction.
- Specs open a market by its URL; none plants a market in storage.

## Considered and rejected

- **Patching the held market from each write's response**: it needs every caller to know every field its write changes, which is the knowledge whose absence caused the stale screens.
- **A thin rail-only fetch beside the stored copy** (`useRailMarket`): it was the state before, and made two holders where there had been three.

## Evidence

An audit on 2026-09-26 walked every value a market screen showed, with throwaway Playwright walks on the primary stack, and found three stale surfaces and one cause: the form tab fetched the form for itself, and two siblings borrowed what it published.
The form builder read its lock once, when it mounted, so after Open Applications it still offered Add field (an edit the server would refuse), and after a return to draft it showed a lock notice naming Applications Open beneath a rail saying Draft; leaving the tab and coming back corrected both.
The priority rules offered a market's own questions as targets only once the form tab had been opened on that visit, so arriving at the Assignment tab directly (where Assign lands, and the links back from Tables and Vendors) hid a market's Category question and told the organizer to add one.
The Applications advisory borrowed the form tab's `formEditable` the same way and was right only by accident, since it showed only once an application existed, which locks the form.
Everything else either derived from the market in hand or reloaded when it changed; the `localStorage` copy caused no bug in that audit, but was where a screen learned which market was open, and a second place the same facts were written.
