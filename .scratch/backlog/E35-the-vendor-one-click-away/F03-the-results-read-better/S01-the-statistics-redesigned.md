---
id: E35/F03/S01
title: The statistics, redesigned
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

Start with a throwaway prototype of two layouts of the assignment statistics on the real November 2026 numbers, in the design language, for Daniel to choose between.
Then rebuild the statistics as chosen, with the same information, drawn from the tokens and primitives.

## As built

- Two layouts were shown on 2026-10-20: A, a ledger of bars (a card per question, each answer a count, its share of all placements and a bar against the largest in its card), and B, one proportion strip per question.
  Daniel chose **A**.
- The figures in the prototype were modelled on the real November 2026 plan and its demand, not a run: the real assignment had not been run yet.
- `utils/resultStatistics.ts` (`statisticsLedger`) turns the server's counts into the ledger, adding the two half-table sides into one row as before; `ResultStatistics.vue` draws it, every row still the control that filters the tables.
- The headings are in sentence case, drawn as the product's small labels, and "Per Table Choice" reads "Per table size", the words the filter chip uses.
- The product has one theme, light, so "in light and dark" was met as light only: the contrast contract is held on white and on a hovered row's beige, and the contrast sweep opens the panel in both states.
  The criterion is ticked on that reading; a dark theme, when there is one, takes this panel with it.

## Acceptance criteria

- [x] Two layouts were shown and one chosen, recorded in this story.
- [x] The statistics show the same numbers as before.
- [x] Every value meets the contrast contract on its ground, in light and dark.
