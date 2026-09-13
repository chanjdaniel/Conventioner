---
id: E04/F04/S02
title: Assignment options typed in the wizard survive leaving the tab
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

Assignment options an organizer has typed are still there when they come back to the Setup tab,
or the wizard tells them what it discarded.

## What is known

The setup wizard persists the market on Back, Next and Assign. The assignment options live on the
wizard's last page, which has no Next, so values typed there are held only in the component until
Assign is pressed.

An organizer who fills them in, switches to the Applications tab to import or review, and returns
finds both fields empty. Nothing says so. The Assign button is then disabled, and it does not say
why either, so the two symptoms do not obviously belong together.

Found by E04/F01/S02: the journey spec set the options on its way past, went to import and review,
came back, and sat waiting for a button that would never enable. The spec now sets them
immediately before assigning, which is the natural order anyway, and is why this is a papercut
rather than a blocker.

## Acceptance criteria

- [ ] Options typed on the last wizard page are still present after switching tabs and back
- [ ] A disabled Assign button says what is missing, rather than only being grey
- [ ] Covered by a test that switches away and back, not only one that fills and assigns
