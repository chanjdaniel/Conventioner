---
id: E33/F01/S03
title: A locked form opens on the review setup
type: story
status: in-progress
blocked_by: [E33/F01/S01]
pr: []
---

## What to build

Once the form locks (an applicant has submitted, or the market has left draft), the tab opens on the review setup step, which stays editable.
The earlier steps are still reachable from the step header, read-only, saying why they are locked.

## As built

- The step is chosen once, as the tab opens: a locked form (the form's own lock, or a person who may only read) opens on Review setup; a lock that lands while the organizer is on a step does not move them off it.
- The earlier steps keep the lock banner with its reason, and the builder is read-only; Review setup shows no banner, since it is still editable.
- The contrast sweep now opens every step the form tab has.

## Acceptance criteria

- [x] A market with a locked form opens the tab on review setup.
- [x] The earlier steps are reachable and read-only, with the lock's reason.
- [x] Review setup saves as before on a locked form.
