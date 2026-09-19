---
id: E09/F06/S01
title: One list row component
type: story
status: done
blocked_by: []
pr: [69]
---

## What to build

The market summary row - name, Created, Organization, Your role, actions - is copied into `MarketsView`, `OrganizationsView`, `DashboardView` and `LoadMarketOverlay` with no shared grid.
The metadata block is laid out after the name rather than in a fixed column, so its left edge follows the name's width.
Measured x of the "Created:" label down the Markets list: **289, 339, 345, 393, 336, 327, 327, 323**.

A row whose organization has been deleted drops the Organization line entirely rather than saying so, which contributes to the jitter.

Extract one component with a real grid, used by all four call sites.
That also settles the role-badge casing, which differs between the two lists today.

## Acceptance criteria

- [ ] One component, four call sites.
- [ ] Every metadata label in a list shares one left edge.
- [ ] A market whose organization is gone says so rather than omitting the line.
- [ ] Neither list nor the dashboard card regresses at 1920x1080.
- [ ] A market's phase is visible on its row, and a running market is distinguishable from a draft.
- [ ] The row shows the market's dates rather than its creation date.

## What the row says

Settled by [ticket 07](../../../wayfinding/readable-journey/issues/07-what-a-market-row-says.md).
The list endpoint returns the whole market document decorated with `user_role`,
`organization_name` and the stamped phase, so none of this costs a query.

| Today | Becomes |
| --- | --- |
| Name | Name |
| **Created**: September 15, 2026 | **Dates**: 21-22 Nov 2026 |
| Organization | Organization |
| **Your role**: Owner | *(dropped)* |
| - | **Phase badge** |

Phase is the single source of truth for a market's state and the list omits it, so a running market
looks like a draft. Created is the weakest thing on the row - an organizer identifies a market by
when it *runs*. Your role is permission detail on a navigation list, and `Manage` is already gated
on it.

Not progress counts: they are not in the payload and would cost a query per row.
