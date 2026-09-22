---
id: E18
title: The workspace follows the phase
type: epic
status: ready
blocked_by: []
pr: []
---

## Outcome

An organizer opens a market and is put where the work is.
The workspace shows the surface for the market's current phase instead of four peer tabs laid over seven phases; a draft is one ordered page that builds the plan before the form it feeds; the three application phases share one surface that says which state it is in; and the assignment phase finally has a home for the two cards that were stranded in Market Setup.

## Why now

The market workspace presents the market-building journey as four peer tabs and six simultaneous plan cards, and the work has a real order that the back end already knows.
`essential_fields` states that the form's offering "is never an independent list: it is the market plan itself", yet the tab bar puts Application Form first.
Assignment Priority and Assignment Options sit in the earliest stage and are usable only in the latest, beside an Assign button that is permanently visible and permanently refused until the market reaches `assignment`.

Charted in [the-order-of-the-work](../../wayfinding/the-order-of-the-work/map.md).
Read tickets [01](../../wayfinding/the-order-of-the-work/issues/01-the-order-of-the-work.md), [02](../../wayfinding/the-order-of-the-work/issues/02-what-the-draft-workspace-looks-like.md), [03](../../wayfinding/the-order-of-the-work/issues/03-what-finalized-means.md), [09](../../wayfinding/the-order-of-the-work/issues/09-who-can-reach-the-public-application-url.md) and [11](../../wayfinding/the-order-of-the-work/issues/11-the-three-application-phases.md) before taking any story; each carries reasoning a story cannot restate.

## What is already settled, and must not be re-litigated

- **The phase spine is correct and `VALID_TRANSITIONS` does not change.**
  Ticket 01 computed it rather than assuming it: `draft -> applications_open -> applications_closed -> review -> assignment -> market_days -> archived`.
  The `assignment` stage already exists and `assign_phase_refusal` already enforces it.
  This epic changes the workspace, not the lifecycle.
- **Draft carries two ordered stages - the plan, then the form built from it.**
  No phase is added between them.
  It is the one dependency the phase machine cannot express, and the draft page expresses it by position.
- **Draft is one scrolling page of ordered sections, not a step wizard.**
  Ticket 02 rejected a wizard because the surface must be resumable and must never force a walk-through to change one value.
  The same layout survives into later phases, so there is one layout for this data rather than two.
- **The three application phases share one surface.**
  Ticket 11 measured the difference and found it small: verdicts are ungated by phase, import spans two of the three, and `applications_closed` changes nothing for a CSV market.
  The surface must **say** which state it is in, in words - hiding a button is not enough, or the rail reads as decorative.
- **Leaving draft is finalizing.**
  Ticket 03: the forward transition stamps the form's publication time and returning to draft clears it. There is no separate Finalize act to invent.
- **Table types stay stubbed for MVP.**
  Ticket 01 settled this deliberately; it is a documented decision, not a gap to fill here.

## Features

Sliced 2026-09-22 with `/to-tickets`.
Ten stories.

- **[`F01` - The draft page](F01-the-draft-page/feature.md)** - one scrolling page of ordered sections, and the calendar that replaces the row-per-date control. Two stories.
- **[`F02` - Surfaces follow the phase](F02-surfaces-follow-the-phase/feature.md)** - the prefactor, the wide refactor it enables, and the two surfaces that gain their content afterwards. Four stories.
- **[`F03` - Finalizing is recorded](F03-finalizing-is-recorded/feature.md)** - the stamp that was designed, threaded through the API, read by two components and never written. One story.
- **[`F04` - A market can take applications online](F04-a-market-can-take-applications-online/feature.md)** - the intake-mode control, and the chip that gives the resulting URL to the organizer. Two stories.
- **[`F05` - The Discord webhook goes](F05-the-discord-webhook-goes/feature.md)** - a tack-on removed from the two surfaces this epic rebuilds, before it rebuilds them. One story.

## The frontier, and the shape of the work

**Four stories are startable now:** `F05/S01` (removing Discord), `F02/S01` (the prefactor), `F03/S01` (finalizing) and `F04/S01` (intake mode).

**Take `F05/S01` first.**
It is deletion work on exactly the two surfaces the rest of the epic rebuilds - a webhook row on the plan and a post-to-Discord action on assignment results.
Removing it before `F02/S01` gives the prefactor less to extract, and removing it before `F01/S01` and `F02/S04` means neither has to decide where a deleted feature goes.
Taken afterwards, it is moved twice.

**`F03/S01` and `F04/S01` are deliberately off the shell's critical path** - one is back-end plus two readers, the other is a plan setting - so they can run in parallel with the restructure rather than queueing behind it.

**One story is a wide refactor.**
`F02/S02` replaces the tab bar, and fifteen end-to-end specs drive this view by tab.
`F02/S01` exists to make that survivable: it extracts the four tab bodies with **no DOM or testid change**, so every spec stays green, and `S02` is then a shell change plus a mechanical spec migration rather than a 1300-line rewrite carrying both.
`F02/S01` is the only story in this epic that changes nothing at all - `F05/S01` also ships no new behaviour, but an organizer sees two controls disappear - and it is worth its own slot for that reason.

**The rest fan out from `F02/S02`:** `F02/S03`, `F02/S04` and `F01/S01` each give one surface its content and can run in parallel once the shell routes by phase.
`F01/S02` follows `F01/S01` so the calendar is designed once, at the width it will actually have.

```
F02/S01 ──> F02/S02 ──┬──> F02/S03   applications surface
(prefactor) (wide)    ├──> F02/S04   assignment surface
                      └──> F01/S01 ──> F01/S02   draft page, then the calendar

F05/S01   remove Discord               (take first - shrinks the three below)
F03/S01   finalizing is recorded        (independent)
F04/S01 ──> F04/S02   intake mode, then the chip
```
