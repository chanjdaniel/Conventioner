---
id: E15/F02/S01
title: A yes/no answer reads as Yes or No
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

On the triage card, a checkbox field's answer renders as the raw boolean `true`.
Every other answer on that card is rendered for a human: dates are spelled out, tier preference is joined per date, table choice reads "A whole table to myself".

Render boolean answers as `Yes` / `No` wherever a stored answer is displayed - the triage card, the vendor detail panel, and the CSV export if it carries them.
The rendering belongs beside the other answer renderers (`front-end/src/utils/essentialFields.ts` holds the essential ones; custom fields are rendered by the application components), not inline at the call site, or the next surface to show an answer will show `true` again.

Check the neighbouring cases while here: an unanswered optional field, and a number field answered `0`.

## Acceptance criteria

- [ ] No rendered answer reads `true`, `false`, `null`, `undefined` or `NaN` on any organizer surface.
- [ ] A checkbox answer reads `Yes` or `No` on the triage card and on the vendor detail panel.
- [ ] A test pins the boolean rendering, so a new answer type cannot reintroduce it.

## Notes

Startable now.
Evidence: `.lavish/aesthetics-2026-09-20.html`, H5.
