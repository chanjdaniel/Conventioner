---
id: E21/F02/S05
title: Nothing about a market is stored in the browser
type: story
status: done
blocked_by: [E21/F02/S02, E21/F02/S04]
pr: []
---

## What to build

The last reads and writes of the stored market go, and a test keeps them gone.

**The dashboard's "continue where you left off"** keeps only `lastMarketId`: a pointer, never a copy.
The dashboard fetches that market fresh to offer it, and silently forgets the id when the market is gone or no longer reachable by this account.
Creating a market or opening one sets the pointer; signing out clears it.

**The guard.**
A unit test fails if any source file reads or writes `localStorage` `market`, the same way the primitives contract guards the controls.

**The record.**
AGENTS.md gains a sharp-edge entry for the model: the store is the one holder of the market, every write is followed by a re-fetch, working copies belong to editors, market screens are addressed by id, and nothing about a market is stored in the browser.
The existing prose that describes the stored market (the Phase Rail entry's `useRailMarket`, the E2E patterns) is corrected rather than appended to.

## Acceptance criteria

- [x] No source file reads or writes `localStorage` `market`, and a unit test fails if one does.
- [x] The dashboard offers the last opened market from a fresh fetch, and offers nothing, without an error, when that market was deleted or access was removed.
- [x] Signing out clears `lastMarketId`.
- [x] AGENTS.md describes the model as built, and no longer describes the stored market.

## Built differently, on purpose

"Silently forgets the id" is not quite what shipped. When the remembered market is gone, the dashboard says so **once** ("The market you last opened is no longer available") and then forgets the pointer, so the next visit is silent.
Saying nothing would put back the falsehood `E14/F01/S02` removed: an organizer whose only market is gone would be greeted with "set up your first market".
