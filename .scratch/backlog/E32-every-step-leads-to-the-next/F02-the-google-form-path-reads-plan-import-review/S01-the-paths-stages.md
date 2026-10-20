---
id: E32/F02/S01
title: The Google Form path's stages are Plan, Import, Review
type: story
status: done
blocked_by: []
pr: [#109]
---

## What to build

The server's phases do not change; how the Google Form path names and walks them does.

- **Leaving draft reads "Import responses."** It moves the market at the click (draft to applications open) and lands on the import. "Reopen for Editing" still undoes it while nothing is imported.
- **The importing stage is named Import**, not Collecting.
- **"Form Closed" is never shown.** Begin Review chains importing, closed and review in one move, judging every hop's guards before the first step, as the form amendment does. It adds no transition edge.
- **Begin Review needs at least one import**: a new guard on that route, worded "Import your Google Form's responses", which by `F01/S02` makes Import the main button until then.

The online-application path is unchanged.

## As built

- The path's moves are the server's: `PASSED_THROUGH` and `path_moves` in `guards.py` say which phases a path steps through and every move open from a phase, and `judge_route` judges a move's whole route (and the form amendment's chain). The market read serves the moves as the keys of `transitionBlockers` and the stepped-through phases as `phasesPassedThrough`; the browser keeps no copy of either rule.
- Each step of a route is taken only from where the step before left the market, so a request that moves it in between stops the walk there.
- A market moved into the closed phase by the single edge is drawn there as "Imported", never "Form Closed". The words the Assignment tab and Reopen for Editing refuse with are true of both paths.
- The single edge into the closed phase is still taken when the API asks for it, so a seed may walk it; review refuses a CSV market with nothing imported on that edge too.
- The move back from review to importing exists with this story, as the route through the closed phase, named "Import more responses"; `S02` is what it does to verdicts and a later export.
- After an import, the import page's "Back to applications" is a secondary button, so the rail's Begin Review is the one green button.

## Acceptance criteria

- [x] A complete Google Form draft offers "Import responses" as its next step, and clicking it lands on the import.
- [x] No Google Form market's rail, tabs or messages say "Collecting", "Done Collecting" or "Form Closed".
- [x] With nothing imported, Begin Review is refused with the new blocker, and Import is the main button.
- [x] After an import, Begin Review moves the market to review in one click and lands there.
- [x] A chain that cannot finish moves nothing.
- [x] The guard lives in the guards module and the registry check accepts it.
- [x] The journey spec walks the Google Form path through the new stages.
