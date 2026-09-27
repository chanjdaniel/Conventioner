---
id: E24/F03/S02
title: The organizer corrects the proposal
type: story
status: ready
blocked_by: [E24/F03/S01]
pr: []
---

## What to build

Every row of the ledger can be corrected in place, and the proposal is the editor's working copy until confirmed ([05](../../../wayfinding/the-form-started-from-a-csv/issues/05-how-you-review-what-the-csv-proposes.md)):

- **What a column becomes**: a menu of who applied, an essential question (and which), a question of your own, or left out; a left-out column can be brought back as a question.
- **A question of your own**: its type menu and Required on one line beneath the fate, and its options as checkboxes with their counts, rare ones ("chosen by 2") unticked until the organizer keeps them. Label, help text and order are edited later in the form builder.
- **The plan's disagreements**: a value the plan does not have (a tier, a date) gets the import's own inline fix, map it to one of the plan's values or ignore it; the plan is never added to.

A corrected row loses its "check this" mark, and the rail's counts follow.
Correcting never blocks: an unchecked row is a suggestion, not an error, and confirm stays available.

## Acceptance criteria

- [ ] Each correction above changes what `S03` would write, and is covered by a component test of the ledger's working copy.
- [ ] Two columns cannot both become the same essential question or the same who-applied target, as in the import.
- [ ] The plan-disagreement fix is the import's own control, not a second one.
- [ ] Playwright: on a fixture, keep a rare option, turn a "one choice" question into "several choices", bring a left-out column back, and see the rail's counts change.
