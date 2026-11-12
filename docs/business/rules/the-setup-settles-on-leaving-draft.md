---
layer: business
kind: rule
describes:
  - back-end/api/markets.py#setup_lock_reason
  - back-end/api/markets.py#setup_part
  - back-end/api/markets.py#prepared_plan
  - back-end/api/markets.py#save_plan
  - back-end/guards.py#SetupHasDatesGuard
  - back-end/guards.py#SetupHasALocationGuard
  - back-end/guards.py#EveryTierHasTablesGuard
  - back-end/guards.py#_earliest_calendar_day
  - back-end/guards.py#LayoutTablesHaveSectionsGuard
  - back-end/api/floorplans_save.py#save_floorplan_to_market
verified: 2026-11-12
sources:
  - wayfinding/the-order-of-the-work/03
  - wayfinding/the-order-of-the-work/map
  - wayfinding/what-to-show-and-when/02
  - wayfinding/what-to-show-and-when/map
  - E18/F03/S01
  - E31/F01
  - E31/F01/S01
  - E31/F01/S02
  - E18
  - E43/F01/S01
  - T263
  - T274
  - T257
---

# The setup settles on leaving draft

Everything on Market Setup (the dates, the locations, the tiers, the sections and their tables, each location layout's seats and the market's table types, the prices, and how vendors reach the market) is settled once the market leaves draft, and may change again only if it goes back.
Where a layout's tables stand is not: until the market is archived its tables still move and turn, and its no-table zones, its image, its scale and its sections' colours and labels still change, while no table is added, removed, renumbered or given another section or type, and no layout starts.
So leaving draft requires a complete setup: dates none of which has passed, a location, and tables at every tier, each its own blocker line.

**Serves:** [The market's phase says what to do next](../intents/the-markets-phase-says-what-to-do-next.md).

## Why

Once the market is out of draft, applicants choose its dates, tiers and sections, and the table allocation assigns vendors in them; a date or a section that moved under them would leave an answer naming something that no longer exists.
A setup that leaves incomplete could therefore never be completed, so the move out of draft asks for each part of it, each pointing at Market Setup.

**One point, not stages.**
The whole setup settles at once, rather than each part when something comes to depend on it, because one point is what an organizer can learn.
Nothing gets past it but the way back to draft below, and where a layout's tables stand: an organizer fixes the layout at the venue, so moving a table, which changes no vendor's table, stays open (T257).
A venue that changes its seats after applications open is not provided for, and would be a feature of its own.
The assignment rules are not setup: they keep [their own lock](the-assignment-rules-close-with-the-assignment.md).
Nor is the Discord card, on the market's Tools tab rather than Market Setup: it is a manual tool the organizer runs whenever they choose (T92 Q10, Q19), so it stays editable until the market is archived ([the Discord connection](../../implementation/modules/discord.md)).

**Leaving draft is finalizing.**
There is no separate act for the organizer to find: the move out of draft is it, and it already judges the plan and the form together, since a plan that offers nothing gives a form that asks nothing ([the guards](../../implementation/modules/guards.md)).
The move stamps the form's `publishedAt` and a return to draft clears it, so the stamp says whether the form is open to applicants now.
It is not the phase restated, because `draft -> archived`, abandoning a draft, does not stamp: a market archived straight from draft never opened its form.
If that edge is ever retired, `publishedAt` becomes derivable from the phase and should be deleted rather than kept; whether the edge stays is not decided.

**A date has passed only once it has passed everywhere.**
A market's date is a day where the market is, and the server does not know where that is, so it refuses a date only once that day is over even at UTC-12 (`_earliest_calendar_day`).
The screens read the viewer's own calendar (`calendarToday` in [`front-end/src/utils/marketGuide.ts`](../../../front-end/src/utils/marketGuide.ts)), so a refusal is one that calendar agrees with.

**The way back is `applications -> draft`, while nobody has applied** (`NoApplicationsYetGuard`); the lock's words name the move while the way is still open.
A Google Form market settles when its first import is written, which is when it leaves draft (E38/F04/S01), and the import says what its setup lacks before a row is read.

## Where it is kept

- `setup_lock_reason` in [`back-end/api/markets.py`](../../../back-end/api/markets.py) says the lock, served on the market as `setupLockReason` so Market Setup reads as settled.
  The plan write (`prepared_plan`) and the floorplan save ([`back-end/api/floorplans_save.py`](../../../back-end/api/floorplans_save.py), [floorplan placement](../../implementation/modules/floorplan-placement.md)) refuse a change after draft; restating the stored setup is not a change (`setup_part` compares the two), because the plan saves itself in every phase.
  Of a layout, `setup_part` compares its seats (each table's id, section, number and type) and the market's table types (`layout.settled_part`, T257), never where a table stands; the plan write keeps the stored layouts whatever it carries.
  Past draft the floorplan save takes a layout whose seats, types and set of layouts are unchanged, and refuses any other, a new layout among them, 409 with the lock's words (`layout.settled_layout_refusal`); the table types' write is refused whole.
  The layout page keeps its editor past draft, under the same words, with what would change a seat disabled ([floorplan placement](../../implementation/modules/floorplan-placement.md)).
  The intake mode is refused separately by the same write, and the assignment rules that ride in the same plan keep [their own lock](the-assignment-rules-close-with-the-assignment.md).
  Each writes through [the market write](../../implementation/modules/market-write.md#the-plans-revision), holding the phase it judged, so an edit judged in draft that lands after Open applications, a move in flight beside it, is refused instead of stored; and Open applications holds the plan's revision, so a plan saved inside the move's window refuses the move instead of leaving draft on a setup its guards never read.
- The three guards (`SetupHasDatesGuard`, `SetupHasALocationGuard`, `EveryTierHasTablesGuard`) are in [`back-end/guards.py`](../../../back-end/guards.py), on `draft -> applications`, kept by [the guards](../../implementation/modules/guards.md).
  `LayoutTablesHaveSectionsGuard` stands beside them (T257): a layout's table in no section is counted by no section, and its section could not be given once the setup settles, so the market stays a draft until each is put in a section or removed.
  Beside them, a price group with a condition the form no longer has is its own line (`PriceGroupsStandGuard`, [a price follows the table](a-price-follows-the-table.md#price-groups)): the prices and the form settle together, so draft is where it is fixed.
- `back-end/tests/test_the_setup_settles_on_leaving_draft.py` and `test_the_setup_is_complete_before_it_settles.py` pin both halves; `test_a_floorplan_save_keeps_the_market_readable.py` (`TestALayoutAfterDraft`) and `a-layout-after-draft.spec.ts` pin the layout's.
- A spec seeds a complete plan, and the room it wants, before it leaves draft ([E2E patterns](../../implementation/testing/e2e-patterns.md#market-dates-and-plans)).
