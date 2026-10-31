---
layer: implementation
kind: module
describes:
  - front-end/src/stores/market.ts
  - front-end/src/utils/openMarket.ts
  - front-end/src/utils/lastMarket.ts
  - front-end/src/utils/marketActions.ts
verified: 2026-10-31
sources:
  - E38/F04/S02
  - wayfinding/the-market-frame/03
  - wayfinding/claims-and-room/02
  - E21/F02/S01
  - E21/F02/S05
  - E21/F02
  - E21/F02/S04
  - E39/F01/S02
  - E41/F01/S01
  - E41/F01/S02
  - E40/F01/S03
  - E40/F01/S04
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

## Where a screen's permission comes from

**From the market in the store, never from a role.**
The market read carries the table's answer for the person asking, per action, as `actionRefusals` ([the market's actions](market-actions.md#what-the-screens-read)), and a screen asks it through one helper, [`front-end/src/utils/marketActions.ts`](../../../front-end/src/utils/marketActions.ts): `mayTake(market, MarketAction.CheckIn)`, or `actionRefusal(...)` for the sentence to say.
A market that carries no answer for an action refuses it, so nothing is offered before the server has said.
Each control asks the row of the action it takes:

| Screen | Control | Row |
| --- | --- | --- |
| The phase rail | every move | Move the phase |
| The phase rail's More…, in Applications | Redo import | Import applications |
| The phase rail's More…, in Applications | Stop taking applications, Take applications again | Stop taking applications, and take them again, while `applicationsStopReason` is null |
| Market Setup, the plan and the floorplan flow | every plan card, the plan's autosave | Change Market Setup |
| The Assignment tab's Settings page | the rules | Allocate tables, change the assignment rules, and assign, swap or free seats, and Change Market Setup, since the rules ride in the plan |
| The Assignment tab's Settings page | Allocate tables | Allocate tables, change the assignment rules, and assign, swap or free seats |
| Tools, the Discord card | Connect, Disconnect, and each choice | Connect Discord and give roles |
| The form tab, and the review's highlights | the questions, the highlights, the automatic rejections | Change the form |
| Applications, the import and the start from a CSV | Import, Start from a CSV | Import applications |
| Applications, the review and All | verdicts and follow-ups | Give verdicts, while `verdictsSettledReason` is null; on an application already approved or rejected, Change a verdict, or overturn an automatic rejection too |
| Applications, the review | Choose reviewers, Change reviewers | Choose reviewers, while `verdictsSettledReason` is null |
| Applications, the review | Publish results | Publish results; disabled with `publishWaitsReason` |
| Assignments, and the drawer's link to it | Change on a seat | Allocate tables, change the assignment rules, and assign, swap or free seats |
| Vendors | Add a vendor | Add a vendor, while `addingVendorsReason` is null |
| Vendors | Check Discord | Connect Discord and give roles |
| The drawer, the review card and Attendance | vendor notes | Write vendor notes |
| The drawer | Update info | Update a vendor's info, and, for an answer the assignment reads, Update info the assignment or price reads |
| The drawer | History | Read the market's history |
| Attendance | Check in, Undo | Check vendors in, in market days |
| Manage market | each role's select, Remove, Add user | the row that gives the role (`canManageRoles` in [`permissions.ts`](../../../front-end/src/utils/permissions.ts)) |
| Manage market | the Permissions section's Show and its rows; its changes; each row's select and Reset to built-in defaults | Read the market; Read the market's history; Change this table |
| Manage market | History | Read the market's history |
| Manage market | Rename; Delete | Change Market Setup; Delete the market |
| The markets list | Manage | Read the market |
| Vendors, Applications' All view, and Assignments | Export; Download CSV | Export CSV |

The frame alone says why a person may change nothing, from `readOnlyReason` ([the market frame](market-frame.md)).
No screen reads the role-shaped reasons the screens read before: every screen that read one is in the table above.
The read serves them, and the person's `user_role`, one more release for a tab still on the old bundle ([the market's actions](market-actions.md#what-the-screens-read)), and the `Market` type names none of them, nor the role, so the type checker refuses a screen that reads one.

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
