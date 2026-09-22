---
id: E18/F02/S02
title: The shell routes by phase
type: story
status: ready
blocked_by: [E18/F02/S01]
pr: []
---

## What to build

Opening a market puts an organizer where the work is.
The workspace shows the surface for the market's current phase instead of four peer tabs, and earlier stages stay reachable - the plan is still editable after draft, and that must keep working.

An organizer never lands on a screen whose main action the phase refuses.

## Why the landing rule changed

The original finding asked for the opposite of what shipped here: it wanted a market to open on the application form until that was finalized, then on the plan.
[Ticket 01](../../../wayfinding/the-order-of-the-work/issues/01-the-order-of-the-work.md) settled that the plan comes **first** and the form is built from it, so that rule is backwards and does not survive.
What replaces it is phase-driven routing, not a patched fallback.

## This is the wide refactor

Fifteen end-to-end specs drive this view by tab, and the tab bar is what they drive.
This story is where they migrate.
Keep the migration mechanical and in one commit separate from the behaviour change, so a reviewer can read the two apart.

## Acceptance criteria

- [ ] The workspace renders the surface for the market's current phase; the tab bar is replaced by navigation along the phase spine.
- [ ] Earlier stages remain reachable and the plan remains editable in every phase after draft.
- [ ] An explicit stage named in the URL still wins over the phase, so a shared or bookmarked link keeps working. This is the one requirement that survives the original finding.
- [ ] The unconditional fallback that always landed on the plan is gone; the phase decides.
- [ ] A market whose phase this build does not recognise still renders something sensible rather than an empty screen - the same defensiveness the rail already has.
- [ ] All fifteen e2e specs are migrated and pass. Their assertions about *what* each surface shows should be preserved; only *how the spec reaches it* changes.
- [ ] `npm run format:check`, `npm run lint:css` and the type check pass.

## Do not

Do not change `VALID_TRANSITIONS`, `guards.py` or the rail's spine.
[Ticket 01](../../../wayfinding/the-order-of-the-work/issues/01-the-order-of-the-work.md) computed the spine and found it already correct; this epic changes the workspace, not the lifecycle.
