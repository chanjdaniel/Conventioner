---
id: E18/F01/S01
title: The draft page
type: story
status: ready
blocked_by: [E18/F02/S02]
pr: []
---

## What to build

A draft market is one scrolling page whose sections run in the order the work actually happens, each at the full width of the workspace:

1. Market dates
2. Tiers
3. Locations and sections
4. How vendors apply - the intake-mode control, if `E18/F04/S01` has landed
5. The application form - **gated until the plan offers something**
6. Open applications, the forward step that is also the finalize

An organizer scrolls once, top to bottom, and the order of the page is the order of the work.
They can also jump straight to any section to change one value, without walking through the others.

## Not a wizard, and not a second layout

Step navigation is ruled out: the surface must be resumable, and it must never force a walk-through to change one value later.
An ordered page communicates order by position instead of enforcing it.

The same layout **survives into later phases**, where the plan stays editable and the sections simply stop being gated.
Do not build a second all-at-once layout for post-draft phases; there is one layout for this data.

## The gate on the form section

The condition already exists and is already computed twice in the back end - by the guard that blocks opening applications, and by the applicant write path.
Read that same statement.

**Do not count custom form fields.**
A form is its custom fields *plus* the essential questions the plan asks, and a layer that asked "does this market have a form?" by counting custom fields is exactly the bug that once let a market open applications and then refuse every application it received.

The gate must say **what is missing**, in the plan's own words - no dates, no tiers, fewer than two sections - not merely appear disabled.
That is the difference between a guided page and a broken one.

## Acceptance criteria

- [ ] A draft market renders as one scrolling page with the sections in the order above, each at the workspace's full width.
- [ ] The page scrolls; no section caps its own height and no nested scroll container is introduced. The project's sizing model - one of two named widths, never a viewport-height shell - is respected.
- [ ] Any section can be reached and edited directly; nothing requires completing an earlier section first except the form gate below.
- [ ] The form section is gated on the same rule the transition guard uses, reached through one shared statement rather than recomputed.
- [ ] The gate names what is missing from the plan. Verify with a market that has no dates, one with no tiers, and one with one section.
- [ ] The same layout renders correctly for a market past draft, with the gate satisfied and the sections editable.
- [ ] Plan autosave continues to work from every section; the existing autosave tests pass.
- [ ] Verified end-to-end by building a market from empty to openable in one pass down the page.

## Note

This page replaces the settings panel that `E17/F02/S02` adds an outer gutter to.
That is known and accepted - `E17` ships first, on the surface the product serves today.
