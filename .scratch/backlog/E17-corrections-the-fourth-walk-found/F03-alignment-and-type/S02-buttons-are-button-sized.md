---
id: E17/F03/S02
title: Buttons are button-sized
type: story
status: done
blocked_by: []
pr: []
---

## What to build

The product's main action button is set at the size the type scale names for a button, and the application form's Save button sits where a form's confirm action belongs.

## Why it is broken today

The shared action-button rule sets its label at the scale step the scale itself documents as *"section headings, card titles"*, while the step documented as *"body, form fields, **buttons**, list rows"* is two steps smaller.
The button is not a near miss on a judgement call - it disagrees with the scale's own stated purpose.

That rule is shared by **four buttons across three screens**: the application form's Save, the plan's Save, and both action buttons on Assignment Results.
It also re-decides height, padding and font family locally, which is exactly what the `.btn` primitive exists to stop.

Separately, the Save button sits bottom **left**: its row is a flex row with no `justify-content`, so it defaults to the start.
That row also carries the save status messages - saved, error, hint - which currently trail the button on its right.

## Acceptance criteria

- [ ] The shared action button adopts `.btn` from the primitives layer rather than re-deciding size, height, padding and font family locally.
- [ ] Its label is set at the scale step the scale names for buttons.
- [ ] All four consumers are verified by screenshot, not assumed: the application form's Save, the plan's Save, and both Assignment Results actions. A smaller label must not leave any of them looking under-filled or change a row's height unexpectedly.
- [ ] The application form's Save button is aligned to the bottom right of its row.
- [ ] The save status messages stay readable and do not crowd the button - verify all four states: saving, saved, validation error, and the incomplete hint.
- [ ] The disabled treatment still reads as disabled after adopting the primitive.
- [ ] `src/__tests__/primitives.test.ts` still passes, and `npm run lint:css` passes.
