# 07: What does a market's row say at a glance?

Type: grilling
Status: resolved
Blocked by: 01

## Question

A market in `market_days` - published, running, serving a public check-in page - renders in the Markets list exactly as a draft does:

```
QC Winter Market 2026 | Created: September 15, 2026 | Organization: Seed Test Org | Your role: Owner | [Open] [Manage]
```

No phase, no badge, no distinction of any kind.
`Phase` is `CONTEXT.md`'s "single source of truth for a market's state" and the list omits it.
The one fact that matters most about a market is the one absent from the only screen that shows all of them.

What the row does carry is questionable in its own right:

- **Created date**, which is rarely what an organizer is looking for; the market's *dates* are not shown.
- **Organization**, silently dropped from the row entirely when the org has been deleted, rather than saying so.
- **Your role**, which is per-market permission detail on a list used for navigation.
- **Two buttons, Open and Manage**, with nothing explaining the difference.

So: what does an organizer need to see about a market without opening it, and what should the two actions be?
Does the row carry the phase as a badge, the next action, both?
Does a running market look different from a finished one, given `archived` means finished and `market_days` means running?

Blocked on [01](01-one-lifecycle-model.md): a phase badge presupposes the lifecycle model the organizer is shown, and if 01 concludes the organizer navigates by "what's next" rather than by phase, the row should say that instead.

Separately and **not part of this ticket** - the row's markup is duplicated in four places (`MarketsView`, `OrganizationsView`, `DashboardView`, `LoadMarketOverlay`) with no shared grid, so the metadata column's left edge follows the market name's width and jitters by up to 104px down the list.
That is `E09` work and does not wait on this answer.

Report findings: **H4** (the list half), **M2**.

## Answer

**Name, market dates, phase badge, organization. The row opens the market; `Manage` stays beside it.
And `Open` currently navigates every published market to a 404.**

### A bug found while resolving this

`pathAfterLoadingMarket()` sends a market in `market_days` or `archived` to `/<slug>` - its public
page - and only a market still being set up to `/market-setup`.
But `/<slug>` is gated by `applicant_intake_market_by_slug` to **form-intake markets only**, and
every MVP market is CSV.

**So the primary action on every published market's row renders "Page not found."**
Verified against the live stack: `/qc-winter-market-2026`, on a market in `market_days` serving a
working check-in page, is a 404.
The comment in that function - "a published one opens the public page it serves" - describes a page
a CSV market does not serve, and the intake-mode gate exists precisely so it does not.

### What the row says

The list endpoint returns the **whole market document**, decorated with `user_role`,
`organization_name` and the stamped phase, so `setupObject.marketDates`, `assignmentObject` and
`intakeMode` are already in hand. Nothing below costs a query.

| Today | Becomes |
| --- | --- |
| Name | Name |
| **Created**: September 15, 2026 | **Dates**: 21-22 Nov 2026 |
| Organization | Organization |
| **Your role**: Owner | *(dropped)* |
| - | **Phase badge** |

- **Phase** is `CONTEXT.md`'s "single source of truth for a market's state" and the list omits it
  entirely, so a running market is indistinguishable from a draft on the only screen that shows all
  of them.
- **Created is the weakest thing on the row.** An organizer identifies a market by when it *runs*.
- **Your role** is per-market permission detail on a list used for navigation, and `Manage` is
  already gated on it, so it earns its space twice over only when someone tries to act.
- **Not progress counts.** Applications-reviewed and similar are not in the payload and would cost a
  query per row on a list that grows.

An organization that has been deleted must say so rather than dropping the line, which is what
produces part of the column jitter today.

### Open goes to the market, always

Not the public page, for any phase.

Building a public market landing page was ruled out of scope by the previous map, and the
intake-mode gate exists so a CSV market has no public face at all - so the conditional's only
purpose was to reach a page that mostly does not exist.

"Open this market" means "show me this market", identically for every market.
Under [01](01-one-lifecycle-model.md) a published market has plenty to show: the rail, the tabs, the
assignment, and **the check-in URL** - which is where the organizer was actually trying to go when
they clicked through to the public page.

### The row is the primary action

The row itself opens the market; `Manage` is a secondary control on it.

Two same-sized adjacent buttons with nothing explaining the difference is the current state.
A row that navigates on click removes the question entirely.
`Manage` stays visible rather than moving into a `...` menu: deleting a market and changing who can
see it are things an owner looks for, and burying a destructive action one level down is what
`E09/F03/S03` is trying to undo elsewhere.

Buildable work: `.scratch/backlog/E09-legible-screens/F06-lists-and-the-payoff-screen/`.
