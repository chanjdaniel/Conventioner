---
layer: implementation
kind: module
describes:
  - front-end/src/utils/marketGuide.ts
verified: 2026-10-22
sources:
  - wayfinding/what-to-show-and-when/02
  - E31/F02/S02
  - E31/F02/S03
  - E31/F03/S02
  - E32/F01/S01
  - E32/F02/S01
  - E33/F01/S02
---

# The market guide

[`front-end/src/utils/marketGuide.ts`](../../../front-end/src/utils/marketGuide.ts) is the one table of what a market's screens say about where it stands and what to do now, for each phase on each intake path.
The phases are the same on both paths; what they are called, what the rail says, and what each tab says out of its phase are not.
A CSV market's vendors apply on the organizer's own Google Form, so nothing it says may suggest they apply here.

## What it answers

- **The page a market is worked on in its phase** (`currentPage`): the page carrying the bar's dot, where `/markets/:marketId` lands, and where the rail's sentence links.
  Only the phase and whether an assignment is stored decide it, so the three can never disagree.
  A phase this build does not recognise gets Market Setup, the one page that is never wrong to show.
- **Where a move into a phase lands** (`landingPage`): that page, or the flow the phase's work is done in; a CSV market's move into `applications_open` lands on the import.
- **The page a tab opens** (`pageForTab`): the one carrying the dot when the tab holds it, else its first.
- **The rail's sentence** (`nextStep`): one sentence naming the one next step, linking to where it is done.
  When the server would refuse that step, the sentence is its first blocker from `transitionBlockers` instead, except before an assignment is run, when running it is the step.
- **The step onward** (`forwardFrom`): read off the spine; once every date of a running market has passed, the step onward is archiving it, and before then archiving stays in the menu.
- **The moves open to the market** (`movesOf`): the keys of `transitionBlockers` as the read served them; the browser keeps no copy of which moves a path has.
- **The spine a market is drawn on** (`spineFor`): the lifecycle less the phases the market's path steps through, with a phase the market is actually in put back where the table places it.
- **Each phase's and each move's name on each path** (`pathPhaseLabel`, `pathTransitionLabel`): on the CSV path `applications_open` is "Import" and leaving draft is "Import responses"; its form tab is "Questions" (`pathTabLabel`), and its form has no preview step (`formSteps`).
- **The line a tab shows while out of its phase** (`tabNote`), rendered in place of the page, once, by [the market frame](market-frame.md): Applications before the market leaves draft, and Attendance before it is published, or for an archived market that never ran.
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

Ticket 02 of the "what to show, and when" map settled the next step per phase and path; this file is that answer as code.

The glossary concepts it serves: [Market](../../business/concepts/market.md), [Phase](../../business/concepts/phase.md) and [Intake mode](../../business/concepts/intake-mode.md).
