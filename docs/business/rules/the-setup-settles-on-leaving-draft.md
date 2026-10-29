---
layer: business
kind: rule
describes:
  - back-end/api/markets.py#setup_lock_reason
  - back-end/api/markets.py#setup_part
  - back-end/api/markets.py#prepared_plan
  - back-end/guards.py#SetupHasDatesGuard
  - back-end/guards.py#SetupHasALocationGuard
  - back-end/guards.py#EveryTierHasTablesGuard
  - back-end/guards.py#_earliest_calendar_day
verified: 2026-10-30
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
---

# The setup settles on leaving draft

Everything on Market Setup (the dates, the locations, the tiers, the sections and their tables, the floorplans, the prices, and how vendors reach the market) is settled once the market leaves draft, and may change again only if it goes back.
So leaving draft requires a complete setup: dates none of which has passed, a location, and tables at every tier, each its own blocker line.

**Serves:** [The market's phase says what to do next](../intents/the-markets-phase-says-what-to-do-next.md).

## Why

Once the market is out of draft, applicants choose its dates, tiers and sections, and the assignment places vendors in them; a date or a section that moved under them would leave an answer naming something that no longer exists.
A setup that leaves incomplete could therefore never be completed, so the move out of draft asks for each part of it, each pointing at Market Setup.

**One point, not stages.**
The whole setup settles at once, rather than each part when something comes to depend on it, because one point is what an organizer can learn.
Nothing gets past it but the way back to draft below; a venue that changes after applications open is not provided for, and would be a feature of its own.
The assignment rules are not setup: they keep [their own lock](the-assignment-rules-close-with-the-assignment.md).

**Leaving draft is finalizing.**
There is no separate act for the organizer to find: the move out of draft is it, and it already judges the plan and the form together, since a plan that offers nothing gives a form that asks nothing ([the guards](../../implementation/modules/guards.md)).
The move stamps the form's `publishedAt` and a return to draft clears it, so the stamp says whether the form is open to applicants now.
It is not the phase restated, because `draft -> archived`, abandoning a draft, does not stamp: a market archived straight from draft never opened its form.
If that edge is ever retired, `publishedAt` becomes derivable from the phase and should be deleted rather than kept; whether the edge stays is not decided.

**A date has passed only once it has passed everywhere.**
A market's date is a day where the market is, and the server does not know where that is, so it refuses a date only once that day is over even at UTC-12 (`_earliest_calendar_day`).
The screens read the viewer's own calendar (`calendarToday` in [`front-end/src/utils/marketGuide.ts`](../../../front-end/src/utils/marketGuide.ts)), so a refusal is one that calendar agrees with.

**The way back is `applications_open -> draft`, while nobody has applied** (`NoApplicationsYetGuard`).
From `applications_closed` it is two moves, Reopen first; the lock's words name the moves while the way is still open.
The completeness guards are on `draft -> applications_open` alone: reopening closed applications re-enters the phase with a setup that settled long ago.

## Where it is kept

- `setup_lock_reason` in [`back-end/api/markets.py`](../../../back-end/api/markets.py) says the lock, served on the market as `setupLockReason` so Market Setup reads as settled.
  The plan write (`prepared_plan`) and the floorplan save (`back-end/api/floorplans_save.py`, [floorplan placement](../../implementation/modules/floorplan-placement.md)) refuse a change after draft; restating the stored setup is not a change (`setup_part` compares the two), because the plan saves itself in every phase.
  The intake mode is refused separately by the same write, and the assignment rules that ride in the same plan keep [their own lock](the-assignment-rules-close-with-the-assignment.md).
- The three guards (`SetupHasDatesGuard`, `SetupHasALocationGuard`, `EveryTierHasTablesGuard`) are in [`back-end/guards.py`](../../../back-end/guards.py), on `draft -> applications_open`, kept by [the guards](../../implementation/modules/guards.md).
- `back-end/tests/test_the_setup_settles_on_leaving_draft.py` and `test_the_setup_is_complete_before_it_settles.py` pin both halves.
- A spec seeds a complete plan, and the room it wants, before it leaves draft ([E2E patterns](../../implementation/testing/e2e-patterns.md#market-dates-and-plans)).
