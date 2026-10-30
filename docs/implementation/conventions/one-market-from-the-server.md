---
layer: implementation
kind: convention
describes:
  - front-end/src/utils/market.ts#parseMarketFromApi
  - front-end/src/__tests__/noMarketInTheBrowser.test.ts
  - back-end/api/markets.py#get_market_for_user
verified: 2026-10-30
sources:
  - wayfinding/the-market-frame/map
  - wayfinding/the-market-frame/02
  - wayfinding/the-market-frame/03
  - E21/F02
  - E21/F03/S06
  - E04/F04/S02
  - T15
---

# One market, from the server

**The back end is the only source of truth about a market, and the browser holds it in one place**: [the market store](../modules/market-store.md).
Every market screen, the phase rail and every tab read it; a screen gets it through `useOpenMarket`.
The decision and its trade-off are [ADR 0009](../../adr/0009-the-back-end-is-the-only-source-of-truth.md).

The glossary concept: [Market](../../business/concepts/market.md).

## The rules

**A write is followed by a re-read, never a patch.**
After anything that changes the market (a transition, which the rail does itself, a plan or form save, an assignment run, a placement, an import, a highlight), call the store's `refresh()`.
Never assign into the held market: no caller should need to know which fields its write touched.
The write itself names what it changes; there is no whole-market write ([ADR 0008](../../adr/0008-each-write-names-what-it-changes.md)).

**Unsaved work is the editor's working copy, never layered on the store.**
The plan keeps its own `setupObject` and `planIntakeMode`, and the form builder its own form.
The editor writes, the store re-reads, and the working copy is reset from it; a re-read never overwrites a working copy that holds unsaved edits.
A phase move once replaced the whole local market with the transition's response, which carries the setup as last saved, so advancing a phase silently discarded every unsaved edit, and Assign was then disabled for a reason the screen never stated.

**Nothing about a market is stored in the browser.**
The `localStorage` key `market` is gone, and [`noMarketInTheBrowser.test.ts`](../../../front-end/src/__tests__/noMarketInTheBrowser.test.ts) fails, naming the file, if any source file reads, writes or removes it again.
The dashboard keeps only the `lastMarketId` pointer, which the store sets when a market arrives.

**Facts derived from the market are served on it, not fetched per tab.**
`GET /markets/:id` ([`get_market_for_user`](../../../back-end/api/markets.py)) stamps every derived fact onto the market it serves: the form lock (`applicationFormLockReason`), the setup and rules locks, `transitionBlockers`, `applicationsStopped`, `phasesReached`, `assignmentOutOfDate`, `orphanedPins`, each person's `actionRefusals` (every row of [the market's actions](../modules/market-actions.md) answered for them, from the rows the market holds) and `readOnlyReason`, the table itself for display (`permissionTable`), the rules of the market's life the rows never override (`verdictsSettledReason`, `addingVendorsReason`, `publishWaitsReason`, and the stage's `applicationsStopReason`, when stopping applications may be taken, E38/F04/S02), and `peopleOnMarket`, whom this reader's follow-up may name: everyone the role rule reaches to someone in the market's organization, the market's own roles to anyone else ([needs follow-up](../../business/rules/needs-follow-up.md)); `peopleOnMarket` is served only to someone who may give a verdict, and every other reader gets an empty list; and `discordSetUp`, whether the deployment has Discord's values ([the Discord connection](../modules/discord.md)).
A tab that fetches a fact for itself and publishes it to its siblings is how the form builder and the priority rules went stale.
Nothing a client sends can write one of these.

**`parseMarketFromApi` carries every field the server sends.**
[`parseMarketFromApi`](../../../front-end/src/utils/market.ts) spreads the payload, and the plan inside it, first, and normalises only the fields it names over them.
It once rebuilt `setupObject` from a fixed key list and dropped `floorplans`; once screens read the parsed market, the plan's autosave erased the floorplan.
Each field the server added and the old list missed (`intakeMode`, `transitionBlockers`, `setupLockReason`) was silently dropped until a screen behaved as though the server had never said it.
A field added to the read now reaches every screen without touching the parser.

## How it is enforced

- `noMarketInTheBrowser.test.ts` reads the source for the stored market key.
- `front-end/src/__tests__/market.test.ts` pins that the parser carries fields it does not name.
- The back end has no route that accepts a whole market (`back-end/tests/test_the_market_put_is_gone.py`).

## What breaks it

- A screen that keeps its own `ref` of the market, or fetches the market itself instead of reading the store.
- A write followed by assigning its response into the held market instead of `refresh()`.
- A parser, mapper or type guard that rebuilds the market from a list of keys.
- A tab computing a fact about the market (a lock, a verdict on a move) that the server already answers.
