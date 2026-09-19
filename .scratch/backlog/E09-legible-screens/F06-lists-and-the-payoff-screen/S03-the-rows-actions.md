---
id: E09/F06/S03
title: The row's actions, and Open stops landing on a 404
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

**`Open` navigates every published market to "Page not found".**

`pathAfterLoadingMarket()` sends a market in `market_days` or `archived` to `/<slug>`, its public
page, and only sends a market still being set up to `/market-setup`.
`/<slug>` is gated by `applicant_intake_market_by_slug` to **form-intake markets only**, and every
MVP market is CSV.
Verified live: `/qc-winter-market-2026`, on a market in `market_days` serving a working check-in
page, renders "Page not found."

The function's comment - "a published one opens the public page it serves" - describes a page a CSV
market does not serve, and the intake-mode gate exists precisely so it does not.

**Open goes to the market's own screens, for every phase.**
Identically, with no conditional. Building a public market landing page is out of scope, and under
`E10` a published market has plenty to show: the rail, the tabs, the assignment, and the check-in
URL - which is where the organizer was trying to get when they clicked through to the public page.

**The row itself opens the market.** `Manage` becomes a secondary control on the row rather than a
second same-sized button competing with `Open`, which is the current state with nothing explaining
the difference. `Manage` stays visible rather than moving into a `...` menu: burying a destructive
action one level down is what `E09/F03/S03` is undoing elsewhere.

## Acceptance criteria

- [ ] Opening a market in any phase lands on that market's screens, never on a 404.
- [ ] `pathAfterLoadingMarket()` no longer branches on phase, or is removed.
- [ ] A row navigates on click, and the click target is the whole row.
- [ ] `Manage` remains visible and role-gated, and does not navigate.
- [ ] An e2e case opens a published market from the list and asserts it does not land on
      "Page not found" - this bug shipped because nothing walked that path.
