---
layer: implementation
kind: module
describes:
  - back-end/guards.py
  - back-end/api/markets.py#create_owned_market
  - back-end/api/markets.py#take_move
  - back-end/api/markets.py#walk_route
  - back-end/api/markets.py#apply_phase_transition
  - back-end/api/markets.py#finalization_update
  - back-end/app.py#transition_market
  - front-end/src/components/BlockerPanel.vue
verified: 2026-10-22
sources:
  - wayfinding/readable-journey/01
  - E03/F03
  - E14/F01/S03
  - E26/F06/S03
  - E31/F02/S01
  - E32/F01/S02
  - E32/F02/S01
  - E05
---

# The guards and the phase move

[`back-end/guards.py`](../../../back-end/guards.py) holds the phase machine: which moves exist, every precondition on each, and the one judgement a move and the rail both make.
A market is moved by [`take_move`](../../../back-end/api/markets.py) (judge, then walk) and its phase written by `apply_phase_transition` beside it; `POST /markets/:id/transition` ([`transition_market`](../../../back-end/app.py)) is the organizer's door to both.

## Its interface

| Name | What it is |
| --- | --- |
| `VALID_TRANSITIONS` | every edge `(from, to)` of the machine; a move not in it answers 400 |
| `TRANSITION_GUARDS` | the guards on each edge, keyed by edge because a precondition can belong to one route |
| `PHASE_ENTRY_INVARIANTS` | the guards every edge into a phase must carry, whatever route reaches it |
| `PreconditionResult` | the wire shape: `id`, `passed`, `message`, and an optional `resolutionLink` (a page of the market, never a redirect) with its `resolutionLabel`, both or neither |
| `route_between(a, b)` | the shortest route between two phases, archiving excluded, by a breadth-first walk of the table |
| `PASSED_THROUGH`, `path_moves(market)` | the phases an intake path steps through, and every move open from the market's phase on its path |
| `judge_route`, `evaluate_transition` | every guard on every step of a move, judged before the first step; failures only |
| `transition_verdicts(market)` | every move open on the market's path, with its blockers; served on the market read as `transitionBlockers` |

## Sharp edges

**Every precondition for every phase transition lives in `guards.py`.**
Adding or removing one is a one-file edit: append a guard to an edge's list, or delete it.
The transition endpoint and the front end's [`BlockerPanel.vue`](../../../front-end/src/components/BlockerPanel.vue) are generic over `PreconditionResult` and must stay that way; the panel renders each blocker's message, and its link only where following it leads somewhere other than the page the organizer is on.

**`_validate_registry()` runs at import and refuses tables that disagree**, so a misspelled phase or a dropped entry invariant is a startup error, not a silent no-op.
It refuses an edge naming a phase `MarketPhase` lacks, guards on an edge that is not in `VALID_TRANSITIONS`, entry invariants for a phase no edge enters, and an edge into a phase that does not carry all of that phase's entry invariants.
An entry invariant is what makes a rule hold of every market in the phase rather than only on the route its author thought of: `market_days` requires a stored assignment, no orphaned pin and, for a form market, published results, on both edges into it.

**A guard reads the market's state, never its phase.**
`judge_route` judges every step of a move against the market as it stands, which is only sound because no guard asks where the market is; `test_no_guard_reads_the_phase` ([`back-end/tests/test_guards.py`](../../../back-end/tests/test_guards.py)) pins it.

**A path may step through a phase it never stops in** (E32/F02/S01).
A CSV market's organizer holds the responses when it leaves draft, so the import is the collection and "applications closed" is never a stage of theirs: `PASSED_THROUGH` names `applications_closed` for the CSV path, and `path_moves` gives that market Begin Review as one move of two steps, `applications_open -> applications_closed -> review`, and back from review a move to `applications_open`.
A market already standing in a passed-through phase keeps every way out it has, so none is stranded.
Every step's guards are judged before the first step is taken, and `walk_route` writes each step through the one phase writer, so the phase history records both.
The single edge of the table is still taken when asked for (`move_route`), so a seed may walk it.
Review refuses a CSV market with nothing imported (`ResponsesImportedGuard`, on `applications_closed -> review`, the edge both routes into review cross; [review needs an import](../../business/rules/review-needs-an-import.md)).
Each step is taken only from where the step before left the market (`walk_route` re-reads it between steps), so a request that moves the market in between stops the walk there rather than being carried over.
[The phase rail](phase-rail.md) draws the screen side: the moves are the keys of `transitionBlockers`, and the stepped-through phases are served as `phasesPassedThrough`, so the browser keeps no copy of either.

**The read and the move cannot disagree about a move.**
`transition_verdicts` calls `evaluate_transition`, the function the endpoint runs, so the rail disables a refused move and names its first blocker before the click.
The endpoint's 409 stays, for a market that changed between the read and the click.

**A market is created only through `create_owned_market` and moved only through `take_move`.**
`POST /markets` creates through the one and the transition endpoint moves through the other, and the operator's seeder ([`back-end/seed_test_markets.py`](../../../back-end/seed_test_markets.py)) calls both, so nothing makes a market someone else owns or takes a move unjudged.
`take_move` asks nothing about who is moving the market: the endpoint asks ADMIN first.
The one other mover is [the form amendment](form-amendment.md) chain (`api/form_amendment.py`), which judges its whole route with `judge_route` against the proposed form before its first step and writes each step through `apply_phase_transition`.

**A rule about phases that is not about a move does not belong here.**
The registry is validated against the transition table and is for transitions, so the phases an organization cannot be deleted in are `BLOCKING_PHASES` in `api/organizations.py` ([when an organization may be deleted](../../business/rules/when-an-organization-may-be-deleted.md)), and the phases the import runs in are `IMPORT_PHASES` in [the CSV import](csv-import.md).

**`Market.phase` is server-owned.**
`create_market` stamps `draft`, and `apply_phase_transition` is the only writer on an existing market: one update, conditional on the stored phase, that sets `phase`, `isDraft` and the form's `publishedAt` (`finalization_update`) and pushes the [phase record](phase-record.md)'s entry.
A request that finds the market moved under it gets `PhaseChangedUnderRequest`, which the endpoint answers with a 409 naming the phase it is in now.
Do not add a second copy of that write: the endpoint carried one until E26, which is how stamps drift.

**Leaving draft finalizes the form.**
`draft -> applications_open` stamps `applicationForm.publishedAt` (giving a market with no stored form one with no custom fields), and a return to `draft` clears it; `draft -> archived`, abandoning a draft, does not stamp, so `publishedAt` says whether the form ever opened, which `phase` alone cannot.

**`offers` is deadlocked, and kept.**
`assignment -> offers` waits on `NoApprovedApplicationsGuard`, and nothing writes the statuses that would clear it; it is a post-MVP phase off the rail's spine, and `market_days` is reached from `assignment` directly.
Its entry invariant is the warning `AssignmentComputedGuard` heeds: a guard must wait on something the product actually writes.

## Why

The guards are where the product's rules about moving a market are kept:

- [The setup settles on leaving draft](../../business/rules/the-setup-settles-on-leaving-draft.md): the three guards on `draft -> applications_open`.
- [Verdicts settle on entering assignment](../../business/rules/verdicts-settle-on-entering-assignment.md): `route_between` decides when the review can no longer be reached.
- [Publish Results waits for the allocation](../../business/rules/publish-results-waits-for-the-allocation.md): `ResultsPublishedGuard`, an entry invariant on `market_days`.
- [The form locks at the first application](../../business/rules/the-form-locks-at-the-first-application.md): `NoApplicationsYetGuard` keeps the way back to draft from being a hole in the lock.
- [An archived market is read-only](../../business/rules/an-archived-market-is-read-only.md): no edge leaves `archived`.
- [Why a vendor was not placed](../../business/rules/why-a-vendor-was-not-placed.md): `NoAskedForTierWithoutTablesGuard` refuses `review -> assignment` while an approved applicant waits on a tier with no tables.

[ADR 0005](../../adr/0005-phase-is-the-only-lifecycle-state.md) records why the phase is the market's only lifecycle state.

What the organizer meets of the guards, phase by phase and path by path, is [the market lifecycle](../../business/flows/lifecycle.md).

The glossary concept it serves: [Phase](../../business/concepts/phase.md).
