---
id: E32/F02/S01
title: The Google Form path's stages are Plan, Import, Review
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

The server's phases do not change; how the Google Form path names and walks them does.

- **Leaving draft reads "Import responses."** It moves the market at the click (draft to applications open) and lands on the import. "Reopen for Editing" still undoes it while nothing is imported.
- **The importing stage is named Import**, not Collecting.
- **"Form Closed" is never shown.** Begin Review chains importing, closed and review in one move, judging every hop's guards before the first step, as the form amendment does. It adds no transition edge.
- **Begin Review needs at least one import**: a new guard on that route, worded "Import your Google Form's responses", which by `F01/S02` makes Import the main button until then.

The online-application path is unchanged.

## Acceptance criteria

- [ ] A complete Google Form draft offers "Import responses" as its next step, and clicking it lands on the import.
- [ ] No Google Form market's rail, tabs or messages say "Collecting", "Done Collecting" or "Form Closed".
- [ ] With nothing imported, Begin Review is refused with the new blocker, and Import is the main button.
- [ ] After an import, Begin Review moves the market to review in one click and lands there.
- [ ] A chain that cannot finish moves nothing.
- [ ] The guard lives in the guards module and the registry check accepts it.
- [ ] The journey spec walks the Google Form path through the new stages.
