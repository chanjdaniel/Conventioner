---
layer: implementation
kind: module
describes:
  - front-end/src/components/PhaseRail.vue
  - front-end/src/components/market/OpenApplicationsDialog.vue
  - front-end/src/utils/phase.ts
  - front-end/src/utils/useScrollsSideways.ts
verified: 2026-10-31
sources:
  - wayfinding/claims-and-room/07
  - wayfinding/readable-journey/01
  - wayfinding/readable-journey/06
  - wayfinding/the-order-of-the-work/09
  - E10/F01
  - E10/F01/S02
  - T45
  - E26/F06/S03
  - E26/F10/S01
  - E31/F02/S01
  - E32/F01/S01
  - E32/F01/S02
  - E32/F02/S01
  - bug/8
  - bug/37
  - bug/44
  - T82
  - E38/F04
  - E38/F01/S01
  - E38/F07/S02
  - T142
---

# The phase rail

[`PhaseRail.vue`](../../../front-end/src/components/PhaseRail.vue) is the market's lifecycle on every market screen, as a band under [the market frame](market-frame.md)'s bar, pinned with it on a desk and scrolling away with the page on a phone.
It replaced `PhaseControlPanel`, which floated above the card.
It draws four things: the spine (the lifecycle, with the market's place marked), the next step in one sentence, the moves, and the market's public addresses (the application page for a form market once it leaves draft, the check-in page once it is published, each with Copy).
What it says comes from [the market guide](market-guide.md); which moves exist and whether each is refused comes from the server.

## Sharp edges

**The rail says no before the click.**
`GET /markets/:id` serves `transitionBlockers`: every move open from the market's phase, each judged by the same guards the move runs (`transition_verdicts` in [`back-end/guards.py`](../../../back-end/guards.py)).
A refused move is drawn disabled, with its first blocker as its reason: in the menu beside it, and for the forward step as the rail's sentence; when that blocker names a page that resolves it, the rail's main button becomes the fix ("Add a location") and leads there, with the move beside it as the step after.
The fix is the move's own first blocker, the one its disabled state is read from, named by the guard that refuses it (`resolutionLabel`), so before a run Publish Market offers "Allocate tables"; on the page that resolves it no fix is drawn, since the work is already in front of the organizer, and the move stays disabled with its reason.
The 409 from `POST /markets/:id/transition` stays for races and renders its blockers under the rail.
Never decide a move's verdict on the front end.

**A remedy or a step is offered only to someone who may take it** (T142).
The fix is drawn only for someone who may move the phase and may take the blocker's `resolutionAction`, the row of [the market's actions](market-actions.md) table its remedy takes; the sentence's link (`phase-rail-next-link`) only for someone who may take the step's `action` ([the market guide](market-guide.md)'s `NextStep`), the blocker's when the step is a blocker's remedy, else the guide row's.
The 409's panel ([`BlockerPanel.vue`](../../../front-end/src/components/BlockerPanel.vue)) draws a blocker's link on the same answer, and still says the blocker.
A missing action, as from an older server, withholds them all, as `mayTake` withholds anything unanswered.
So a Viewer reads where the market stands and is led nowhere, an Editor on a draft missing its dates is still led to "Pick market dates", and an Admin whose table refuses the setup is offered no fix; the sentence is the same for everyone ([what each role may do](../../business/rules/what-each-role-may-do.md)).

**Both paths draw the same five stages, named by the path.**
The rail's moves are the keys of `transitionBlockers`, and the browser keeps no copy of them.
The stage where applications arrive and are reviewed is `applications`, drawn "Review" on a Google Form market and "Applications" on the other (`pathPhaseLabel`, [ADR 0016](../../adr/0016-one-stage-for-applications-and-review.md)).
A Google Form market's draft offers the fix "Import responses" as its main button, with "Begin Review" disabled beside it: the import takes that move once its rows are written.

**More… holds the stage's actions beside its moves.**
`stageActions` in [the market guide](market-guide.md) gives a Google Form market in Review "Redo import", which opens the import and moves nothing, and an own-form market in Applications "Stop taking applications" or "Take applications again", a write to `POST /markets/:id/applications-stopped` after which the store re-reads the market (E38/F04/S02, S03).
They come first in the menu, as `phase-rail-action-<id>`, offered only to an Admin and, for the stop, only when the read's `applicationsStopReason` is null.
The moves follow them, any back edge first and Archive Market last, so the destructive move is never in the middle.

**The spine is derived, never listed.**
`phaseSpine()` in [`front-end/src/utils/phase.ts`](../../../front-end/src/utils/phase.ts) walks `VALID_TRANSITIONS` (the front end's mirror of the server's table) forward from `draft`, taking at each step the one edge to somewhere new that is not `archived`, and appends `archived`.
A second list beside the table would be the drift `_validate_registry()` refuses on the server.
`offers` is off it (`OFF_SPINE_PHASES`), since nothing sets `assignment_sent`, except for a market actually in that phase, which gets its stage back where the table puts it so the rail can still say where it stands; no move into `offers` is ever offered.

**Forward, back and destructive are read off the spine** (`transitionDirection`), never special-cased per phase.
Only the one forward step is on the rail; every other move is in the "More…" menu behind `phase-rail-menu-button`, a real menu whose arrow keys walk its items and whose Escape or an outside press closes it.
The menu's box clips its items to its rounded corners, so a focused item wears its halo inside its edge, as every menu's item does (`--focus-halo-inset`, [the design language](../../design-system.md#the-primitive-layer)).
Choosing an item also closes it and hands focus back to `phase-rail-menu-button`, before the Publish or Archive confirm opens, so that confirm gives focus back there when it closes ([dialogs](../conventions/dialogs.md)).
A spec that clicks `phase-transition-<phase>` for a back or destructive edge opens that menu first.
A move that cannot be undone (`transitionNeedsConfirmation`, derived from the table: today `market_days` and `archived`) asks first in a dialog.
"Open Applications" out of an own-form draft, for someone the table's Choose reviewers row lets choose (`offersReviewers`), opens [`OpenApplicationsDialog.vue`](../../../front-end/src/components/market/OpenApplicationsDialog.vue) instead: the reviewer picker, whose confirm saves the reviewers when the choice differs from the stored team (`sameTeam` in [`reviewTeam.ts`](../../../front-end/src/utils/reviewTeam.ts), which the first import's preview step uses alike) and then hands the move back to the rail ([taking applications](../../business/flows/taking-applications.md#h1-open-applications), [the review is dealt among chosen reviewers](../../business/rules/the-review-is-dealt-among-chosen-reviewers.md)).
A save the server refuses keeps that dialog open with its error and makes no move; a move refused after a save re-reads the market, so the rail and a second try show the reviewers chosen.
A Google Form market's way into the stage is its first import, so its rail offers no picker, and nor does it to someone who may move the phase but not choose reviewers.
Someone the table's Move the phase row refuses (`mayTake(market, MarketAction.MovePhase)`, E39/F01/S02) is offered no move at all, and the rail still says where the market stands ([what each role may do](../../business/rules/what-each-role-may-do.md)).

**A move lands on the guide's page for the phase entered**, in any direction (`landingPage`), and the router starts a new page at its top.
The rail navigates there itself: it once emitted an event no screen listened to, so every move landed on the server and the organizer stayed where they had clicked, an import's result still drawn (E32/F01/S01).
A spec that clicks a move follows it to that page; it does not stay on the tab it clicked from.
Before posting, the rail awaits the screen's `beforeTransition` (the plan flushes its pending autosave there), and after the move it calls the store's `refresh()`.

**A terminal state is stated in words.**
Strikethrough alone reads as stopped, not as archived; the prototype proved it, so an archived rail says what became of the market ("It was published and ran its market days.") and keeps the strikethrough only as reinforcement.
An archived market's frozen stage is the furthest phase in `phasesReached`, the server's [phase record](phase-record.md); it was once read off evidence, and told a market that ran that no check-in page ever went on the air (bug 8).
Without a complete record (`phaseRecordComplete: false`) the rail says only what is proven and strikes nothing through.

**The addresses give way, and the rail's end travels as one piece.**
On a desk an address chip is the one flexible part of the row: it drops the scheme every address shares and ellipses the rest, so the part naming the market shows, while the link, its hover text and Copy keep the whole address.
The addresses and the moves are one item of the row; where the row cannot hold them beside the spine, they take a second row together, addresses at its start and moves at its end, rather than leaving one button alone beside an empty band.
Which addresses show, and when, is [a gated market answers as absent](../../business/rules/a-gated-market-answers-as-absent.md) for the application page, and `market_days` or an archive that ran for check-in.

**The rail is one row at the workspace width, and on a phone it is laid out for one** (T142), at the app's phone break (`width <= 640px`); see [the design language](../../design-system.md#layout).
On a phone its rows are, in order: the spine, on one line that scrolls sideways inside itself; the rail's end, one wrapping row group with the address chips at its start and the actions, as one group, at its end, where nothing shrinks below its content: a chip or the actions that do not fit beside what is before them take a row of their own, and the actions wrap at the row's end; the sentence, with its link on a line of its own; then the frozen note, an error or the 409's panel.
A chip on a phone draws its name ("Application page", "Check-in page") as the link, with the whole address as its `title`, and Copy, and no address text: squeezed beside the actions it showed one character of the address in a 171x148px box.
Which chip shape draws is decided in the script (`onAPhone`, `useMediaQuery` on the same break), since the link's text is what changes; so one chip holds one link at any width, and a spec reading the link at a phone reads its `href` or `title`.
Each chip is one line, 50px: a 44px Copy inset by the desk's 2px hairline in the chip's border, since with no inset Copy's border lay on the chip's; the step link is `--target-min` (44px) tall, and the buttons are through `.btn`.
At the door in market days on a form market, both chips and More…, the door starts at 319px of 844 on first paint, within the top 340px `phase-rail.spec.ts` holds it to; it started at 409px.
While the spine scrolls it is a keyboard stop named "Phases", so the phases past the window's edge can be reached (axe's `scrollable-region-focusable`); [`useScrollsSideways`](../../../front-end/src/utils/useScrollsSideways.ts) measures it, and on a desk, where it fits, it is no tab stop (T82).
Focused, it wears the shared halo of every `[tabindex='0']` ([the design language](../../design-system.md#the-primitive-layer)), with no rule of its own.
The layout sweep walks the rail on Attendance at 390 in every phase the screens seed holds, both intake paths among them, so a squeezed chip, an overlap or a control past the window fails it; a link drawn on a line of its own is a tap target to it, and only a link inside a run of text is exempt.

**Crowding is measured between labels, never by overflow.**
The steps shrink below their labels rather than overflowing the row, so the row reports that it fits while the labels paint over each other; `phase-rail.spec.ts` checks that no two adjacent labels' boxes overlap at 1920x1080 with a long check-in address.

## Why

The phase is the single source of truth for a market's lifecycle; the rail reads it and its moves from the server and decides neither.
The rules for moving a market are with [the guards](guards.md) in `back-end/guards.py`, and why the phase is the only lifecycle state is [ADR 0005](../../adr/0005-phase-is-the-only-lifecycle-state.md).
What an organizer reads on the rail in each phase, and what refuses each move, is [the market lifecycle](../../business/flows/lifecycle.md).
Opening applications, and stopping and taking them again, on the rail beside its application page's address, is [taking applications](../../business/flows/taking-applications.md).

The glossary concept it serves: [Phase](../../business/concepts/phase.md).
