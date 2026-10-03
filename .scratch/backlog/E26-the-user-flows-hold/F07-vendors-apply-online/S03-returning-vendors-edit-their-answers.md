---
id: E26/F07/S03
title: Returning vendors edit their saved answers
type: story
status: done
blocked_by: []
pr: [88]
---


## What to build

The apply page opens with the vendor's saved answers, Your Application links to it while applications are open, and a reload does not sign the vendor out.

Closes bugs 21, 36 in `docs/MVP_BUGS.md`; each one's reproduction there is the starting E2E.

## Acceptance criteria

- [x] A vendor with an application sees their answers on the apply page.
- [x] Your Application has an edit link while applications are open.
- [x] Reloading the apply page keeps the vendor signed in.
