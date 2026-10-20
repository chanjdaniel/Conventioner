---
id: E33/F03/S01
title: The organizer sets the automatic-rejection rules
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

The review setup step gains an "Automatic rejections" section.
A rule names one choice question (select, multi-select or checkbox, essential or the organizer's own) and the answers that reject; for a checkbox, "not ticked" is an answer.
The organizer can add, edit and remove rules.
The rules stay editable after the form locks, and freeze when the market enters Assignment, saying why.
The server is the authority: it refuses a rule on a free-text question, an answer the question does not offer, and any change once the market has reached Assignment.

## As built

- `back-end/rejection_rules.py` says which questions a rule may name (`rejection_questions`: the organizer's selects, multi-selects and checkboxes, and the essential table choice) and what a rule may say (`prepared_rules`).
- A rule with no answer yet is kept, and rejects nobody: the organizer picks the question first.
- The rules close while the market cannot return to review (`rejection_rules_lock_reason` in `api/markets.py`, derived from the transition table like the assignment rules' lock).
- `PUT /markets/:id/rejection-rules` (EDITOR) writes the whole list; the market read serves `rejectionQuestions` and `rejectionRulesLockReason`, so the step offers exactly what the write takes.
- Review setup holds two sections, what a reviewer reads first and the automatic rejections; both save through `useSavedOnTheMarket`, extracted from the highlights' composable.
- A checkbox's answers are "ticked" and "not ticked".
- The essential choices offered are the ones the market asks: the table choice and the available dates. Tier preference is a grid of a tier per day, not one choice, so no rule names it.
- The rules are served as they stand against the current form (`Rulebook`): a rule on a question or an answer the form no longer offers is left out, so it never blocks a save of the list.

## Acceptance criteria

- [x] A rule can be made on the no-show agreement ("not ticked") and on the affiliation question (the answers that are not accepted).
- [x] Free-text questions are not offered, and the server refuses them.
- [x] Rules are editable on a locked form and refused from Assignment on, with the reason shown.
