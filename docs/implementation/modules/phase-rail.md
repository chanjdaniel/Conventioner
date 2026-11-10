---
layer: implementation
kind: module
describes:
  - front-end/src/components/PhaseRail.vue
  - front-end/src/components/market/OpenApplicationsDialog.vue
  - front-end/src/utils/phase.ts
verified: 2026-11-10
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
  - E38/F15/S03
  - E38/F15/S04
  - T207
  - T205
  - T206
  - T217
  - T214
  - T260
---

# The phase rail

[`PhaseRail.vue`](../../../front-end/src/components/PhaseRail.vue) is the market's lifecycle on every market screen, as a band under [the market frame](market-frame.md)'s bar, pinned with it on a desk and scrolling away with the page on a phone.
It replaced `PhaseControlPanel`, which floated above the card.
It draws four things: the spine (the lifecycle, with the market's place marked), the next step in one sentence, the moves, and the market's public addresses (the vendor page while it answers, a form market's once it leaves draft and a Google Form market's once its results are published or it reached its market days, and after an archive only if it ran (`sharesVendorPage` in `vendorPage.ts`), with Copy; its vendors check in there too, with the door code, so the check-in page that stood beside it is gone, [ADR 0022](../../adr/0022-the-vendor-page-is-signed-in.md)).
What it says comes from [the market guide](market-guide.md); which moves exist and whether each is refused comes from the server.

## Sharp edges

**The rail says no before the click.**
`GET /markets/:id` serves `transitionBlockers`: every move open from the market's phase, each judged by the same guards the move runs (`transition_verdicts` in [`back-end/guards.py`](../../../back-end/guards.py)).
A refused move is drawn disabled, with its first blocker as its reason: in the menu beside it, and for the forward step as the rail's sentence, to someone who may take the blocker's remedy (the guide's `nextStep`); when that blocker names a page that resolves it, the rail's main button becomes the fix ("Add a location") and leads there, with the move beside it as the step after.
The fix is the move's own first blocker, the one its disabled state is read from, named by the guard that refuses it (`resolutionLabel`), so before a run Publish market offers "Allocate tables"; on the page that resolves it no fix is drawn, since the work is already in front of the organizer, and the move stays disabled with its reason.
That page is the link's path and every query value it names (`isHere` in [`market.ts`](../../../front-end/src/utils/market.ts), T206): a fix leading to `form?step=review` is drawn from Your questions and not on Review setup, and one leading to `applications` is not drawn on `applications?view=one`.
The 409 from `POST /markets/:id/transition` stays for races and renders its blockers under the rail, and the rail reads the market again, since it may have changed since it was read: a fix in that panel then leads to a page that shows the market as the server judged it, Review setup asking again for a decision another organizer undid (T206).
Never decide a move's verdict on the front end.

**A remedy or a step is offered only to someone who may take it** (T142).
The fix is drawn only for someone who may move the phase and may take the blocker's `resolutionAction`, the row of [the market's actions](market-actions.md) table its remedy takes; the sentence's link (`phase-rail-next-link`) only for someone who may take the step's `action` ([the market guide](market-guide.md)'s `NextStep`), the blocker's when the step is a blocker's remedy, else the guide row's.
The 409's panel ([`BlockerPanel.vue`](../../../front-end/src/components/BlockerPanel.vue)), headed "Cannot proceed:", draws a blocker's link on the same answer (`blockerLink`), and still says the blocker.
A missing action, as from an older server, withholds them all, as `mayTake` withholds anything unanswered.
So an Editor on a draft missing its dates is still led to "Pick market dates", and a Viewer, or an Admin whose table refuses the setup, is offered no fix ([what each role may do](../../business/rules/what-each-role-may-do.md)).
Where the step, or the remedy of the blocker refusing it, is not theirs, the sentence is not the step either: the guide says what they may do there, a read, and the rail links it like any other step, so a Viewer on a draft missing its dates reads "The market is being planned. Read its plan on Market Setup.", and at the door reads "Follow who has checked in at the door." and from another tab is led to Attendance ([the market guide](market-guide.md), E38/F15/S04).

**Both paths draw the same five stages, named by the path.**
The rail's moves are the keys of `transitionBlockers`, and the browser keeps no copy of them.
The stage where applications arrive and are reviewed is `applications`, drawn "Review" on a Google Form market and "Applications" on the other (`pathPhaseLabel`, [ADR 0016](../../adr/0016-one-stage-for-applications-and-review.md)).
A Google Form market's draft offers the fix "Import responses" as its main button, with "Begin review" disabled beside it: the import takes that move once its rows are written.

**More… holds the stage's actions beside its moves.**
`stageActions` in [the market guide](market-guide.md) gives a Google Form market in Review "Redo import", which opens the import and moves nothing, and an own-form market in Applications "Stop taking applications" or "Take applications again", a write to `POST /markets/:id/applications-stopped` after which the store re-reads the market (E38/F04/S02, S03).
They come first in the menu, as `phase-rail-action-<id>`, offered only to an Admin and, for the stop, only when the read's `applicationsStopReason` is null.
The moves follow them, any back edge first and Archive market last, so the destructive move is never in the middle.

**The spine is derived, never listed.**
`phaseSpine()` in [`front-end/src/utils/phase.ts`](../../../front-end/src/utils/phase.ts) walks `VALID_TRANSITIONS` (the front end's mirror of the server's table) forward from `draft`, taking at each step the one edge to somewhere new that is not `archived`, and appends `archived`.
A second list beside the table would be the drift `_validate_registry()` refuses on the server.
`offers` is off it (`OFF_SPINE_PHASES`), since nothing sets `assignment_sent`, except for a market actually in that phase, which gets its stage back where the table puts it so the rail can still say where it stands; no move into `offers` is ever offered.
The Markets list's Phase filter offers the same spine (`FILTERABLE_PHASES` in [`front-end/src/utils/marketList.ts`](../../../front-end/src/utils/marketList.ts), E38/F15/S03), so it never offers a stage the rail does not draw.

**Forward, back and destructive are read off the spine** (`transitionDirection`), never special-cased per phase.
Only the one forward step is on the rail; every other move is in the "More…" menu behind `phase-rail-menu-button`, a real menu whose arrow keys walk its items and whose Escape or an outside press closes it.
A focused item draws the green focus border of every button, inside its edge, so the menu's rounded box does not clip it ([the design language](../../design-system.md#the-primitive-layer)).
Choosing an item also closes it and hands focus back to `phase-rail-menu-button`, before the Publish, Archive or Back to review confirm opens, so that confirm gives focus back there when it closes ([dialogs](../conventions/dialogs.md)).
A spec that clicks `phase-transition-<phase>` for a back or destructive edge opens that menu first.
A move that cannot be undone (`transitionNeedsConfirmation`, derived from the table: today `market_days` and `archived`) asks first in a dialog.
"Back to review", the way from `assignment` to the stage (`pathTransitionLabel` reads the origin), asks first too, by its edge (`isBackToReview`), since it can be undone but costs the allocation: an `AppDialog`, `back-to-review-confirm`, titled "Back to review?", whose paragraphs say the review opens again, the allocated tables must be allocated again before results are published, a seat placed by hand stays, and, on an own-form market only, that applications stay closed ([ADR 0021](../../adr/0021-the-review-reopens-until-results-are-published.md)).
It is drawn as a back move, and once results are published it is disabled with `ResultsNotPublishedGuard`'s message beside it, as any refused move in the menu is.
"Open applications" out of an own-form draft, for someone the table's Choose reviewers row lets choose (`offersReviewers`), opens [`OpenApplicationsDialog.vue`](../../../front-end/src/components/market/OpenApplicationsDialog.vue) instead: the reviewer picker, whose confirm saves the reviewers when the choice differs from the team it starts from (`teamToChange` and `sameTeam` in [`reviewTeam.ts`](../../../front-end/src/utils/reviewTeam.ts), which the first import's preview step uses alike: the team being written, else the team last written over the market held, else the stored team) and then hands the move back to the rail ([taking applications](../../business/flows/taking-applications.md#h1-open-applications), [the review is dealt among chosen reviewers](../../business/rules/the-review-is-dealt-among-chosen-reviewers.md)).
Below the picker the dialog names the review setup it opens, as the market serves it (T206): "What a reviewer reads first:" and the labels of the live marks in the order they lead the card (`leadingLabels` in [`reviewHighlights.ts`](../../../front-end/src/utils/reviewHighlights.ts)), or "Nothing leads the card"; "Automatic rejections:" and how many rules reject an answer (`rejectingRules` in [`rejectionRules.ts`](../../../front-end/src/utils/rejectionRules.ts)), or "None" ([review waits on the review setup](../../business/rules/review-waits-on-the-review-setup.md)).
The rail opens the dialog only while the move has no blocker, so both read decided; a market that reached it undecided all the same reads "not decided yet" rather than a decision nobody took.
Its "Change" leads to `form?step=review` and closes the dialog, and is drawn only for someone who may take `change-form`.
A save the server refuses keeps that dialog open with its error and makes no move; a move refused after a save re-reads the market, as every refused move does, so the rail and a second try show the reviewers chosen.
A move and a re-read that both fail after a save leave the market held from before it, and a second try still starts from the team written, and writes nothing unless it changes.
During its write the dialog holds, with `closeDisabled` ([dialogs](../conventions/dialogs.md)), and "Change" is hidden with its box kept, and a confirm first waits on a write left unanswered by a dialog browser history took (`unansweredWrite`), so nothing moves before its answer and a refusal shows here.
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
Copy stands at the chip's end at every width (`margin-left: auto`), so a chip wider than its words, an 18rem floor round a short address or a phone's half row, leaves its room between the address and Copy; with a short address it stood mid-chip (T260), which `the-rail-addresses.spec.ts` holds at 1280 and 390.
The addresses and the moves are one item of the row; where the row cannot hold them beside the spine, they take a second row together, addresses at its start and moves at its end, rather than leaving one button alone beside an empty band.
When the address shows is [a gated market answers as absent](../../business/rules/a-gated-market-answers-as-absent.md) for the vendor page ([ADR 0022](../../adr/0022-the-vendor-page-is-signed-in.md)).

**The rail is one row at the workspace width, and on a phone it is laid out for one** (T142), at the app's phone break (`width <= 640px`); see [the design language](../../design-system.md#layout).
Its phone gutter, 16px, is the frame's on a screen that fits a phone only ([the market frame](market-frame.md#sharp-edges)); one that keeps the desktop floor keeps the desk's inset, so the rail lines up with its page.
On a phone its rows are, in order: the spine, on one line that scrolls sideways inside itself; the rail's end, one wrapping row group with the address chips at its start and the actions after them, where nothing shrinks below its content: each chip and each action that does not fit beside what is before it takes the next row, a chip asks for over half its row and takes what the row leaves, so an action may stand beside it, and the actions stand at their row's end, More… last; the sentence, with its link on a line of its own; then the frozen note, an error or the 409's panel.
The actions wrap one by one (`.phase-rail-actions` gives up its box), but for the move and More…, one box that does not break (`.phase-rail-tail`): wrapped as one group they left More… alone on a third row under two buttons that had room beside the application page; one by one, three actions that do not fit a phone's row (a draft's fix and move, the Google Form path's Review) left it alone on the next; and, while the rail had two chips, the two side by side at a 326px rail left it alone under them.
So More… stands alone on its row only where nothing else is on the rail's end.
`phase-rail.spec.ts` ("The rail's end wraps only when it must") walks phones 375 to 430 wide, in market days, taking applications on both intake paths and in a draft with no dates, and fails on an item that wrapped where it fitted or a More… alone on its row.
Between a phone and a desk, where the screens that fit a phone ([the design language](../../design-system.md#layout)) reach every width, the same describe walks 680 to 780, and fails on a More… alone on its row.
"sizes the address chip by the phone's own rule" in the same spec reads the chip's basis at 390.
A chip on a phone draws its name ("Vendor page") as the link, with the whole address as its `title`, and Copy, and no address text: squeezed beside the actions it showed one character of the address in a 171x148px box.
Which chip shape draws is decided in the script (`onAPhone`, `useMediaQuery` on the same break), since the link's text is what changes; so one chip holds one link at any width, and a spec reading the link at a phone reads its `href` or `title`.
Each chip is one line, 50px: a 44px Copy inset by the desk's 2px hairline in the chip's border, since with no inset Copy's border lay on the chip's; the step link is `--target-min` (44px) tall, and the buttons are through `.btn`.
At the door in market days on a form market, its chip and More…, the door starts within the top 340px of 844 on first paint, which `phase-rail.spec.ts` holds it to; it started at 409px.
The spine stands in a [`ScrollBox`](../../../front-end/src/components/ScrollBox.vue) with `axis="x"`, whose shades say which end has more (T217), the `ol` of steps inside it, so the list and its name hold; the test id `phase-rail-spine` names the scroller, and the class `phase-spine` the list.
While the spine scrolls that box is a keyboard stop and a region named "Phases", so the phases past the window's edge can be reached (axe's `scrollable-region-focusable`); on a desk, where it fits, it sets `--scroll-box-overflow: visible` and is neither a stop nor a region (T82).
Focused, it wears the inset halo of every `ScrollBox` that is a stop ([the design language](../../design-system.md#the-primitive-layer)), with no rule of its own.
The layout sweep walks the rail on Attendance at 390 in every phase the screens seed holds, both intake paths among them, so a squeezed chip, an overlap or a control past the window fails it; a link drawn on a line of its own is a tap target to it, and only a link inside a run of text is exempt.

**Crowding is measured between labels, never by overflow.**
The steps shrink below their labels rather than overflowing the row, so the row reports that it fits while the labels paint over each other; `phase-rail.spec.ts` checks that no two adjacent labels' boxes overlap at 1920x1080 with a long check-in address.

## Why

The phase is the single source of truth for a market's lifecycle; the rail reads it and its moves from the server and decides neither.
The rules for moving a market are with [the guards](guards.md) in `back-end/guards.py`, and why the phase is the only lifecycle state is [ADR 0005](../../adr/0005-phase-is-the-only-lifecycle-state.md).
What an organizer reads on the rail in each phase, and what refuses each move, is [the market lifecycle](../../business/flows/lifecycle.md).
Opening applications, and stopping and taking them again, on the rail beside its vendor page's address, is [taking applications](../../business/flows/taking-applications.md).

The glossary concept it serves: [Phase](../../business/concepts/phase.md).
