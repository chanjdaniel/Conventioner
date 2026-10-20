---
id: E31/F01/S02
title: The setup refuses changes once the market has left draft
type: story
status: done
blocked_by: [E31/F01/S01]
pr: [#109]
---

## What to build

The plan write (`PUT /markets/:id/plan`) and the floorplan save refuse any change to the setup once the market is not in draft, in words ("The setup is settled once applications open; go back to draft to change it, while no one has applied").
Restating the stored setup is not a change, as with the intake mode today.
The assignment rules ride in the same object and are not setup: they keep their own lock (`assignment_rules_lock_reason`), so a rules change in review or assignment still saves.
The server is the authority; the front end mirrors it (S03).

## Acceptance criteria

- [x] In every phase after draft, a changed date, location, section, table count, tier or floorplan is refused; in draft each saves.
- [x] A rules-only change saves in `review` and `assignment` and is refused where it is today.
- [x] Returning to draft (no applications) makes the setup editable again.
- [x] Seeds and specs that edit the plan after draft (the walk did, in review) are moved to draft.
