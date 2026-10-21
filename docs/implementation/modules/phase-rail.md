---
layer: implementation
kind: module
describes:
  - front-end/src/components/PhaseRail.vue
  - front-end/src/utils/phase.ts
verified: 2026-10-22
sources:
  - E10/F01
  - E10/F01/S02
  - E26/F06/S03
  - E31/F02/S01
  - E32/F01/S01
  - E32/F02/S01
  - bug/8
  - bug/37
  - bug/44
---

# The phase rail

[`PhaseRail.vue`](../../../front-end/src/components/PhaseRail.vue) is the market's lifecycle on every market screen, as a band under [the market frame](market-frame.md)'s bar, pinned with it.
It replaced `PhaseControlPanel`, which floated above the card.
It draws four things: the spine (the lifecycle, with the market's place marked), the next step in one sentence, the moves, and the market's public addresses (the application page for a form market once it leaves draft, the check-in page once it is published, each with Copy).
What it says comes from [the market guide](market-guide.md); which moves exist and whether each is refused comes from the server.

## Sharp edges

**The rail says no before the click.**
`GET /markets/:id` serves `transitionBlockers`: every move open from the market's phase, each judged by the same guards the move runs (`transition_verdicts` in [`back-end/guards.py`](../../../back-end/guards.py)).
A refused move is drawn disabled, with its first blocker as its reason: in the menu beside it, and for the forward step as the rail's sentence; when that blocker names a page that resolves it, the rail's main button becomes the fix ("Add a location") and leads there, with the move beside it as the step after.
The 409 from `POST /markets/:id/transition` stays for races and renders its blockers under the rail.
Never decide a move's verdict on the front end.

**A path may step through a phase it never stops in.**
The rail's moves are the keys of `transitionBlockers`, served for the market's own path, and the spine leaves out the phases the read lists in `phasesPassedThrough`: a CSV market's rail reads Draft, Import, Review, Assignment, Market Days, Archived, and Begin Review is one move through `applications_closed`.
The browser keeps no copy of either list.

**The spine is derived, never listed.**
`phaseSpine()` in [`front-end/src/utils/phase.ts`](../../../front-end/src/utils/phase.ts) walks `VALID_TRANSITIONS` (the front end's mirror of the server's table) forward from `draft`, taking at each step the one edge to somewhere new that is not `archived`, and appends `archived`.
A second list beside the table would be the drift `_validate_registry()` refuses on the server.
`offers` is off it (`OFF_SPINE_PHASES`), since nothing sets `assignment_sent`, except for a market actually in that phase, which gets its stage back where the table puts it so the rail can still say where it stands; no move into `offers` is ever offered.

**Forward, back and destructive are read off the spine** (`transitionDirection`), never special-cased per phase.
Only the one forward step is on the rail; every other move is in the "More…" menu behind `phase-rail-menu-button`, a real menu whose arrow keys walk its items and whose Escape or an outside press closes it.
A spec that clicks `phase-transition-<phase>` for a back or destructive edge opens that menu first.
A move that cannot be undone (`transitionNeedsConfirmation`, derived from the table: today `market_days` and `archived`) asks first in a dialog.
Someone below ADMIN (`adminActionsReason`) is offered no move at all, and the rail still says where the market stands ([what each role may do](../../business/rules/what-each-role-may-do.md)).

**A move lands on the guide's page for the phase entered**, in any direction (`landingPage`), and the router starts a new page at its top.
A spec that clicks a move follows it to that page; it does not stay on the tab it clicked from.
Before posting, the rail awaits the screen's `beforeTransition` (the plan flushes its pending autosave there), and after the move it calls the store's `refresh()`.

**A terminal state is stated in words.**
Strikethrough alone reads as stopped, not as archived; the prototype proved it, so an archived rail says what became of the market ("It was published and ran its market days.") and keeps the strikethrough only as reinforcement.
An archived market's frozen stage is the furthest phase in `phasesReached`, the server's [phase record](phase-record.md); it was once read off evidence, and told a market that ran that no check-in page ever went on the air (bug 8).
Without a complete record (`phaseRecordComplete: false`) the rail says only what is proven and strikes nothing through.

**The rail is one row at the workspace width**, and on a phone its spine scrolls sideways inside itself; see [the design language](../../design-system.md#layout).

## Why

The phase is the single source of truth for a market's lifecycle; the rail reads it and its moves from the server and decides neither.
The rules for moving a market are with [the guards](guards.md) in `back-end/guards.py`, and why the phase is the only lifecycle state is [ADR 0005](../../adr/0005-phase-is-the-only-lifecycle-state.md).
What an organizer reads on the rail in each phase, and what refuses each move, is [the market lifecycle](../../business/flows/lifecycle.md).
Opening, closing and reopening applications on the rail, beside its application page's address, is [taking applications](../../business/flows/taking-applications.md).
