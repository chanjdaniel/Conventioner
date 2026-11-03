---
layer: implementation
kind: module
describes:
  - front-end/src/utils/marketGuide.ts
verified: 2026-11-03
sources:
  - wayfinding/what-to-show-and-when/02
  - wayfinding/what-to-show-and-when/map
  - E31/F02/S02
  - E31/F02/S03
  - E31/F03/S02
  - E32/F01/S01
  - E32/F02/S01
  - E33/F01/S02
  - E33/F01/S01
  - E38/F04
  - T142
  - E38/F15/S04
  - T207
---

# The market guide

[`front-end/src/utils/marketGuide.ts`](../../../front-end/src/utils/marketGuide.ts) is the one table of what a market's screens say about where it stands and what to do now, for each phase on each intake path.
The phases are the same on both paths; what they are called, what the rail says, and what each tab says out of its phase are not.
A CSV market's vendors apply on the organizer's own Google Form, so nothing it says may suggest they apply here.

## What it answers

- **The page a market is worked on in its phase** (`currentPage`): the page carrying the bar's dot, where `/markets/:marketId` lands, and where the rail's sentence links.
  Only the phase and whether an assignment is stored decide it, so the three can never disagree.
  A phase this build does not recognise gets Market Setup, the one page that is never wrong to show.
- **Where a move into a phase lands** (`landingPage`): that page; a row may name a flow its work is done in instead (`lands`), but none does now, so a move into the stage lands on Applications on both paths.
- **The page a tab opens** (`pageForTab`): the one carrying the dot when the tab holds it, else its first.
- **The rail's sentence** (`nextStep`): one sentence naming the one next step, linking to where it is done.
  When the server would refuse that step, the sentence is its first blocker from `transitionBlockers` instead, for someone who may take the blocker's remedy, except before an assignment is run, when running it is the step.
- **The action a step takes** (`NextStep.action`): the row of [the market's actions](market-actions.md) table the step's work takes, so [the phase rail](phase-rail.md) links the sentence only for someone who may take it ([what each role may do](../../business/rules/what-each-role-may-do.md)).
  A step read off a blocker takes the blocker's `resolutionAction`, served by [the guards](guards.md); a step read off the guide's row takes the row's `action`:

  | Phase, standing | Page | Action |
  | - | - | - |
  | draft | setup | `change-setup` |
  | applications | applications | `give-verdicts` |
  | assignment, not assigned | settings | `assign` |
  | assignment, assigned, results not published | assignments | `assign` |
  | assignment, results published | assignments | `move-phase` |
  | offers | assignments or settings | `assign` |
  | market days, a date to come | attendance | `check-in` |
  | market days, every date over | attendance | `move-phase` |
  | archived | none | none: the sentence leads nowhere |

  A row with no action is one whose sentence links nowhere; a blocker with none, as from an older server, gives the step none.
- **What someone the step's action refuses is told instead** (`GuideRow.onlooker`), where the row's sentence would tell them to do it: what they may do there, a step taking `read` that leads to the row's page (E38/F15/S04).
  It never says what they may not, which [the market frame](market-frame.md)'s read-only line says once; the rail had told a Viewer "Check vendors in at the door." just above it, and on every other row a step that was not theirs either.
  The step is a standing blocker's remedy, else the row's own action, and the server serves a move's blockers to everyone: so a blocker reads only to someone who may take its remedy, as T142 decided for them, and anyone else reads the onlooker sentence.
  Each onlooker sentence is true whether the row's blockers stand or have passed, on either path.
  A blocker that names no remedy reads to someone who may do the row's work, and to an onlooker only when its guard is one of `FACTS`, keyed on the guard's id: today only `all_applications_reviewed`, which names no remedy only to say "There are no applications for this market.", read after the stage's lead in the onlooker's words.
  Every other guard the rail can meet that names no remedy has two, on two pages, and its message ends in them (`no_orphaned_pin`'s "Restore the seat in the plan, or move or free those vendors.", `no_asked_for_tier_without_tables`'s "Add a section at that tier, or reject those applications", `form_has_fields`'s "Add market dates, tiers or sections ... or add a custom field"), so an onlooker reads the onlooker sentence instead; so does one from a guard this build does not know.
  `no_applications_yet` names no remedy and is a fact too, but it guards only the move back to draft, which is never the rail's step onward.
  By the built-in table a Viewer reads, in draft, "The market is being planned. Read its plan on Market Setup."; in the stage, what the stage is in words that ask nobody to review (`watchedStageLead`), then "Read where each application stands." or, on a Google Form market, "Read where each response stands.", whether applications still wait or every one is decided; in Assignment, "Tables are not allocated yet. Read the rules they will follow on Settings.", or "Tables are allocated, and the market is not published yet. Read the assignments." on both paths, while a form market's results wait to be published too, or, once results are published, "Results are published, so the assignments are settled. The check-in page goes up when the market is published."; at the door "Follow who has checked in at the door.", and once every date has passed "The market has run. Who came is on Attendance."; and on a market left in Offers, which nothing moves a market into now but whose step onward still has blockers, "This market is in Offers. Read the assignments." or, with nothing allocated, "Read the rules on Settings." after the same first sentence.
  The sentence goes with the answer, not the role: a chosen Viewer may give verdicts, so reads the stage's own sentence and its blocker, and an Editor reads the onlooker's where the row's work is moving the phase.
- **What someone who may do the row's work, but not take the step onward, is told** (`GuideRow.helper`): the step onward is the standing blocker's remedy, or, with none standing, moving the phase.
  Only Assignment with tables allocated and results not published has one: an Editor may change the seats there but publish neither the results nor the market, and reads "Check the assignments; the results are published by whoever may publish them." on a form market, or "Check the assignments; the market is published by whoever may publish it." on a Google Form market, a step taking `assign`.
  A remedy-less blocker in their way, such as an orphaned pin, they may put right, so they read it instead.
  [`a-viewer-reads-what-is-theirs-before-the-door.spec.ts`](../../../front-end/e2e/a-viewer-reads-what-is-theirs-before-the-door.spec.ts) holds it for a Viewer and an Editor at both widths, in the stage with an application waiting and in a form market's Assignment before its results are published.
  An archive has none, since its sentence is true for everyone.
- **The step onward** (`forwardFrom`): read off the spine; once every date of a running market has passed, the step onward is archiving it, and before then archiving stays in the menu.
- **The moves open to the market** (`movesOf`): the keys of `transitionBlockers` as the read served them; the browser keeps no copy of which moves a path has.
- **The spine a market is drawn on** (`spineFor`): the lifecycle, with a phase it leaves out, such as `offers`, put where the table places it when the market is actually in it.
- **Each phase's and each move's name on each path** (`pathPhaseLabel`, `pathTransitionLabel`): on the CSV path `applications` is "Review" and the move into it from draft "Begin review", on the other "Applications" and "Open applications" ([ADR 0016](../../adr/0016-one-stage-for-applications-and-review.md)), and the move into it from `assignment` is "Back to review" on both ([ADR 0021](../../adr/0021-the-review-reopens-until-results-are-published.md)); a CSV market's form tab is "Questions" (`pathTabLabel`), and its form has no preview step (`formSteps`).
- **What the stage says it is** (`stageLead`): every imported response is here, or the application page is open, or it is not taking applications; it leads the stage's statement and its blocker alike, and `watchedStageLead` says the same in words that ask nobody to review, for someone who may not decide.
- **The stage's actions that are not moves** (`stageActions`): "Redo import" on the CSV path, and "Stop taking applications" or "Take applications again" on the other, each for someone the server would let take it.
- **The line a tab shows while out of its phase** (`tabNote`), rendered in place of the tab's pages, never a flow it holds, once, by [the market frame](market-frame.md): Applications before the market leaves draft, and Attendance before it is published, or for an archived market that never ran.
  The locks the server owns (the setup's, the form's, the rules') are the server's and shown where they apply; this says only what the phase alone decides.
- **Today, on the viewer's own calendar** (`calendarToday`), read by the rail and by Attendance alike.
  The server calls a date over only once it is over everywhere, so any date it refuses is over on this calendar too.

**Every tab stays on the bar for the market's whole life**, Attendance included; a tab out of its phase shows its note rather than leaving the bar.

## Sharp edges

**Change what a screen says here, and nowhere else.**
A per-screen sentence about the phase is how the rail, the bar's dot and the landing page used to disagree about where a market is.
The rail ([the phase rail](phase-rail.md)), the bar, the page row and `MarketLanding` all read this table.

**Intake mode is read the server's way**: `intakeModeOf` takes an absent mode as CSV, so the applicant surface fails closed on screen as on the server ([ADR 0006](../../adr/0006-intake-mode-fails-closed.md)).

## Why

Ticket 02 of the "what to show, and when" map settled the next step per phase and path; this file is that answer as code, and the sentences it says are listed in [the lifecycle](../../business/flows/lifecycle.md#what-the-rail-says).
A screen says what to do now in two ways, both from here: the one sentence on the rail, which lives on every market screen beside the step it leads to, and the line a tab shows out of its phase, so a tab never disappears.
The guards' verdicts are served on the market read, so the rail knows a move would be refused without trying it.

The glossary concepts it serves: [Market](../../business/concepts/market.md), [Phase](../../business/concepts/phase.md) and [Intake mode](../../business/concepts/intake-mode.md).
