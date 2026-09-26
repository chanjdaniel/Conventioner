---
id: E17/F02
title: Space that shows structure
type: feature
status: done
blocked_by: []
pr: []
---

## Outcome

Space in this product groups what belongs together and separates what does not: plan-card rows render whole rather than clipped, and no control's focus ring lands on its neighbour.

## Why now

The fourth walk found four places where spacing actively works against the structure it should express.
Plan-card rows overflow their own scroll container and are clipped by it.
The form builder puts more space inside one field than between two, so nothing groups.
The sign-in form's second input draws its focus ring into the first.
The phase rail's current step wears a ring that takes no part in layout and so consumes the gap meant to separate it from its label.

## Stories

- `S01` - plan-card rows render whole.
- `S02` - three spacing corrections that each stand alone.
