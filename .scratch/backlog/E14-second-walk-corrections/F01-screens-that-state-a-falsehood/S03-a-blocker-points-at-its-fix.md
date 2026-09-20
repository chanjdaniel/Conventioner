---
id: E14/F01/S03
title: A blocker points at its fix
type: story
status: done
blocked_by: []
pr: [75]
---

## What to build

`BlockerPanel`'s resolution link reads "Fix this →" and every blocker so far sets it to `/market-setup` - which is where every blocker is raised from.
Clicking it does nothing visible.

The two fixes `NoAskedForTierWithoutTablesGuard` names live in different places: *add a section at that tier* is the Market Setup tab, *reject those applications* is the Applications tab.
The link points at neither specifically.

Give a guard's `resolution_link` the tab that actually holds its fix, and have the panel say nothing rather than offer a link to the current page when the two coincide.

## Acceptance criteria

- [x] No resolution link navigates to the page it is displayed on.
      `BlockerPanel` resolves the link through the router and compares it with the current
      location, so the decision follows where the panel is being read from.
      The rail puts it on four screens, so the same blocker's link is useful from three of them and
      dead on the fourth - it cannot be decided once, on the server.
- [x] Each guard's link names the tab holding its remedy, where one tab does.
      Only two guards turn out to qualify: reviewing is `?tab=applications`, and running the solver
      is `?tab=assignment`.
- [x] A guard whose remedy spans two places offers no link rather than a misleading one.
      Three guards, not two.
      `FormHasFieldsGuard` (plan or custom field), `NoAskedForTierWithoutTablesGuard` (add a section
      or reject the applications), and `NoOrphanedPinGuard` - see below.

## Notes

Finding F8 in `.lavish/qc-2026-09-20.html`.
`resolution_link` is already per-guard in `back-end/guards.py`, so this is data, not structure.

## Corrections to the description above

Not *every* blocker pointed at `/market-setup`.
`AssignmentComputedGuard` and `NoApprovedApplicationsGuard` pointed at `/assignment-results`, and
`NoOrphanedPinGuard` already named a tab.

`/assignment-results` is a **redirect** to `/market-setup?tab=assignment`, so those two did reach
the right tab - but only after a hop, and `router.resolve()` does not follow one.
A link left as a redirect would have read as "leads elsewhere" from the very tab it lands on, which
is the dead link this story removes.
Both now name the destination directly; the route stays for anyone navigating to it by hand.

`NoOrphanedPinGuard` already named a tab, and the tab it named was wrong.
Its message offers two remedies - "Restore the seat in the plan, or move those vendors" - and
`?tab=assignment` holds neither: the plan is the Market Setup tab, and moving a vendor is the Tables
view, which `front-end/src/views/TablesView.vue` is the only caller of.
The assignment tab reports the assignment rather than editing it.
It now points nowhere, like the other two-remedy guards.
Note that no fixed string in `guards.py` could name the Tables view even if there were one remedy,
because that route carries a market id.

## Where the rule is pinned

`tests/test_guards.py::TestEveryResolutionLinkPointsAtItsFix` reads every `resolution_link` literal
out of `guards.py` with `ast` and refuses a bare page or a redirect.
Per-guard assertions would not have caught this: the bare `/market-setup` reached four call sites
because each was written on its own, and the next guard would be a fifth.

## Known limitation: a guard cannot point at the plan

`?tab=setup` is refused, not allowed.
`tabFromRoute()` renders the setup tab for a bare `/market-setup` as well, so the URL does not
distinguish the two, and a link to `?tab=setup` would read as leading elsewhere from the very page
it lands on - the dead link this story exists to remove.

Nothing needs it today: every guard whose remedy is the plan has a second remedy somewhere else and
so offers no link at all.
A guard that ever needs to point there wants the market screen to put its default tab in the URL
first, which is a change to routing rather than to blockers.
