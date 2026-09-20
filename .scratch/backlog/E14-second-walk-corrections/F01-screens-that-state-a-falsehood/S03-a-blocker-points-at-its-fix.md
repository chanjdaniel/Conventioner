---
id: E14/F01/S03
title: A blocker points at its fix
type: story
status: in-progress
blocked_by: []
pr: []
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
      Reviewing is `?tab=applications`; running the solver and re-placing a pin are
      `?tab=assignment`.
- [x] A guard whose remedy spans two places offers no link rather than a misleading one.
      `FormHasFieldsGuard` (plan or custom field) and `NoAskedForTierWithoutTablesGuard` (add a
      section or reject the applications) both name both remedies in the message and link to
      neither.

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

## Where the rule is pinned

`tests/test_guards.py::TestEveryResolutionLinkPointsAtItsFix` reads every `resolution_link` literal
out of `guards.py` with `ast` and refuses a bare page or a redirect.
Per-guard assertions would not have caught this: the bare `/market-setup` reached four call sites
because each was written on its own, and the next guard would be a fifth.
