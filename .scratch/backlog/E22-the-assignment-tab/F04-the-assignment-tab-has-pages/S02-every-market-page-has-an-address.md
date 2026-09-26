---
id: E22/F04/S02
title: Every market page has its own address, and the bar reaches every one
type: story
status: ready
blocked_by: [E22/F01/S02]
pr: []
---

## What to build

Every market page is its own route: `/markets/:id/setup`, `/form`, `/applications`, `/assignment`, `/result`, `/vendors`, `/attendance` (Import and Floorplan keep theirs).
The old addresses redirect to theirs, so a bookmark or a link in an email still lands: `setup?tab=form` and its siblings, and `/tables` (which becomes `/result`).

The market's bar - its name and its tabs - is on every one of them, rendered once by the frame rather than by each screen:

- **Tabs**: Market Setup, Application Form, Applications, Assignment, and **Attendance once the market is published** (`market_days`, `archived`).
- **A tab opens the page where the market is worked on in its phase**, the page carrying the dot: in `assignment` with an assignment stored, Assignment opens Result; in `market_days`, the market opens on Attendance.
- **Import and Floorplan** are flows entered from their tab; they carry the bar with that tab active.
- **The Back buttons go** from Tables, Vendors and Attendance: they existed because those screens had no tabs.

`marketPath()` is the one builder of these addresses; nothing builds one by hand.

## Acceptance criteria

- [ ] Each page's address opens it directly, and a refresh keeps it.
- [ ] Every old address (`setup?tab=…`, `/tables`) redirects to its page, keeping the market.
- [ ] The bar is on every market page, with the right tab active, including Import and Floorplan.
- [ ] Attendance is a tab exactly when the market is published, and appears without a reload when the rail publishes it.
- [ ] Opening the market, or a tab, lands on the page for its phase.
- [ ] No Back button remains on a market screen.
- [ ] The e2e page objects reach pages by these addresses (`e2e/helpers/marketScreens.ts`).
