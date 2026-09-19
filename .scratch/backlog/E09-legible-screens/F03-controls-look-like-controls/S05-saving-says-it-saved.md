---
id: E09/F03/S05
title: Saving says it saved
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

The Application Form tab runs two save models side by side and only one of them tells you anything.

Unticking "Ask this" on Section preference fires `PUT /markets/:id/application-form` immediately - confirmed 200 in the network log - and **nothing on screen acknowledges it**.
No "Saved", no spinner, no state change.
Six inches away, custom fields require an explicit "Save Form" click which does show a status.

The organizer has no way to tell which of their changes are already persisted.

The same field also has a hint that reads as a refusal: with no custom fields, Save Form is disabled and says "This form already asks the essential questions. Add a field to save one of your own."
That sentence is correct and the code comment explaining it is good, but standing beside a toggle that saved silently a second ago it reads as "your change cannot be saved".

**Assignment Options clamps silently too.**
Typing `99` into "Max assignments per vendor" produces `2` - the number of market dates - with no message.
Typing `150` into "Max half table proportion per section (%)" produces `100` on blur.
Both fields are `type="text"` with no `min`/`max`, so there is no numeric keyboard on a phone and no browser validation, and neither has help text, a default, or an explanation of what a half-table proportion is - while the Assign button stays disabled until both are filled.

## Acceptance criteria

- [ ] Every persisted change on the Application Form tab produces visible confirmation, whichever save model it uses.
- [ ] A value the product changes on the organizer's behalf says so and says why.
- [ ] The two assignment options are numeric inputs with stated bounds and a one-line explanation each.
