---
id: E21/F02/S02
title: Market Setup is addressed by id and reads the store
type: story
status: done
blocked_by: [E21/F02/S01]
pr: []
---

## What to build

Market Setup at `/markets/:marketId/setup?tab=...`, with the rail and all four tabs reading the market from the store, and every write on it followed by a re-fetch.

An organizer can bookmark or share a link to any tab of any market and it opens that market.
Opening a market from the dashboard or the Markets list goes to its id-addressed URL.
The old `/market-setup` path, which never carried an id, sends the organizer to the Markets list.

**Writes re-fetch.**
A transition from the rail, a form save, an assignment run and a review-highlight change are each followed by the store re-fetching the market.
What goes: the rail merging the new phase, the form tab assigning `applicationForm` onto the market in place, Assign replacing the market wholesale, and `handlePhaseAdvanced` hand-keeping the plan over a fresh market.
Assignment results read the market from the store, and re-read after a run because the store changed, not because a `:key` was bumped.

**Editors keep working copies.**
The plan and the form builder each edit a working copy kept apart from the store.
They write, the store re-fetches, and the working copy is reset from the fresh market.
A re-fetch that lands while the working copy holds unsaved edits leaves those edits alone.
The rail still flushes pending plan edits before a transition.

**Tests.**
One e2e helper opens a market at a tab by URL.
Every spec and page object that reaches Market Setup by writing `localStorage` and going to `/market-setup` moves to it.

## Acceptance criteria

- [x] `/markets/:marketId/setup?tab=<tab>` opens that market on that tab; `/market-setup` goes to the Markets list.
- [x] The dashboard, the Markets list and every in-app link to Market Setup use the id-addressed URL.
- [x] The rail and all four tabs read the market from the store; none of them reads `localStorage` `market`.
- [x] After each of transition, form save, assignment run and highlight change, the store re-fetches, and nothing patches the held market locally.
- [x] Typing into the plan and firing a transition before the autosave lands keeps what was typed, both on screen and on the server.
- [x] The e2e specs that reached Market Setup through `localStorage` navigate by URL through one helper, and the full e2e suite passes.
