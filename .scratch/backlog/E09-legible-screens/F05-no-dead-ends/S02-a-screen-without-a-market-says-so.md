---
id: E09/F05/S02
title: A screen without a market says so instead of pretending
type: story
status: done
blocked_by: []
pr: [69]
---

## What to build

Four organizer routes take no parameters and read `localStorage.market`: `/market-setup`, `/import-applications`, `/assignment-results`, `/vendors`.

Loading `/market-setup` directly, after signing out and back in, renders a page titled **"Settings"** with an empty Market Dates panel, no phase strip, and an enabled **Next** button.
It is an editable setup wizard attached to no market.

`/vendors` in the same state renders "No market loaded. Go back to the dashboard to choose one." - which is the right shape of answer, and the other three should match it.
Note that `/vendors` is reached from a drawer link reading "View Vendors", which reads as a global vendor directory and is in fact the vendors of whichever market was last opened; its heading names that market.

Separately, `setupPageIdx` is a **single global localStorage key** with no market id in it, so the wizard opens wherever the organizer last stood in any market.
A second market therefore skips the Market Dates step entirely - which matters because market dates are what the solver assigns across and what generates the "which dates can you attend" question.

## Acceptance criteria

- [ ] None of the four routes renders an editable surface when no market is loaded; each redirects to `/markets` or shows the same empty state `/vendors` does.
- [ ] The stored wizard step is keyed per market, or the wizard opens at step 0 whenever `setupObject.marketDates` is empty.
- [ ] The drawer entry for `/vendors` names what it actually shows.
- [ ] A page with no market never shows a placeholder title in place of a market name.

## Notes

Putting the market id in the path is **out of scope** on the map: guarding removes the lie, which is what the destination asks for, and routing by id is justified by deep links and two-tab support, which is a separate effort.
Do not take the refactor here.

**Superseded in part, 2026-09-19.**
[Ticket 01](../../../wayfinding/readable-journey/issues/01-one-lifecycle-model.md) makes the plan
editor one page, which **deletes `setupPageIdx`** rather than keying it (`E10/F02/S01`).
If that lands first, drop the second acceptance criterion; if this story lands first, key the step
and expect `E10/F02/S01` to remove it.
The no-market guard half is untouched by that answer and stays.
