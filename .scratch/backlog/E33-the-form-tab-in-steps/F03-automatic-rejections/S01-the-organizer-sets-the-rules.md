---
id: E33/F03/S01
title: The organizer sets the automatic-rejection rules
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

The review setup step gains an "Automatic rejections" section.
A rule names one choice question (select, multi-select or checkbox, essential or the organizer's own) and the answers that reject; for a checkbox, "not ticked" is an answer.
The organizer can add, edit and remove rules.
The rules stay editable after the form locks, and freeze when the market enters Assignment, saying why.
The server is the authority: it refuses a rule on a free-text question, an answer the question does not offer, and any change once the market has reached Assignment.

## Acceptance criteria

- [ ] A rule can be made on the no-show agreement ("not ticked") and on the affiliation question (the answers that are not accepted).
- [ ] Free-text questions are not offered, and the server refuses them.
- [ ] Rules are editable on a locked form and refused from Assignment on, with the reason shown.
