---
id: E26/F07/S03
title: Returning vendors edit their saved answers
type: story
status: proposed
blocked_by: []
pr: []
---


## What to build

The apply page opens with the vendor's saved answers, Your Application links to it while applications are open, and a reload does not sign the vendor out.

Closes bugs 21, 36 in `docs/MVP_BUGS.md`; each one's reproduction there is the starting E2E.

## Acceptance criteria

- [ ] A vendor with an application sees their answers on the apply page.
- [ ] Your Application has an edit link while applications are open.
- [ ] Reloading the apply page keeps the vendor signed in.
