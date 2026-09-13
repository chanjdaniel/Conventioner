---
id: E02/F02/S01
title: Build a priority rule from a form question
type: story
status: done
blocked_by: [E02/F01/S02]
pr: []
---

## What to build

An organizer opens their market's priority settings, picks one of their own form questions, arranges that question's answers best-first, and the assignment order changes accordingly.

A rule names a target and an ordering.
The ordering's shape follows from the target's type rather than being declared alongside it: a question with a fixed set of answers is ordered by arranging those answers.
The `<All others>` token stays, so an organizer need not enumerate every value, and any answer they did not place falls where that token sits.

Three fields disappear from the model in this story, and one parallel array with them.
A rule no longer carries a column index, a declared data type, or a sorting order, and the market's setup no longer carries a per-column array of enum orderings.
The ordering lives on the rule itself, which removes the index arithmetic entirely.

The UI is in scope here rather than in a follow-up, because the existing screen writes exactly the fields this story deletes.
Splitting them would ship a settings screen that cannot save.

Two of the five data types the screen advertises are removed rather than implemented.
"Contains" and "Does not contain" are predicates, not orderings: they sort into two buckets, which a yes/no question expresses more honestly.

## Acceptance criteria

- [ ] A priority rule names a form field key and carries its own ordering
- [ ] The rule's ordering shape is derived from the target field's type, not declared separately
- [ ] The declared data type, the sorting order, and the column index are gone from the rule model
- [ ] The per-column array of enum orderings is gone from the market setup model
- [ ] The solver orders vendors by the configured rules, in rule order
- [ ] An answer not placed in the ordering falls at the `<All others>` position, or last when no such token is present
- [ ] The priority screen's target picker lists the market's own form questions, and the data-type dropdown is gone
- [ ] "Contains" and "Does not contain" are no longer offered
- [ ] A rule an organizer configures demonstrably changes the assignment order, proven by a test that would fail under the old silent behaviour
- [ ] Frontend and backend tests cover rule creation, reordering, and scoring
- [ ] `docs/schema.d.ts` is regenerated from the contract models rather than hand-edited

## Notes

The current screen renders a data-type dropdown the solver reads nothing from, so a rule configured as a number in ascending order scores every vendor identically and does nothing, with no error and no warning.
Deriving the ordering from the target is what makes that state unrepresentable rather than merely discouraged.

The only priority configurations that exist anywhere are in tests.
Nothing has shipped and there is no deployment, so expect nothing to migrate; F04/S02 owns confirming that against a real database.
