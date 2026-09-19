---
id: E09/F07/S01
title: Check-in names the market and says which day
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

- **The market name arrives after the work, not before it.**
  Before a lookup the card reads "Vendor Check-in"; after, "Check in for QC Winter Market 2026".
  A vendor handed a URL or a QR code needs the confirmation first.
- **Every date offers an identical "Check in" button** with nothing marking today.
  On a two-day market a vendor can check in for tomorrow by tapping the wrong card, and there is no undo.
- **No instructions.**
  Nothing says to use the email they applied with.
- **The confirmation is over-precise**: "Checked in ✓ at 9/15/2026, 7:20:18 AM".

## Acceptance criteria

- [ ] The market name is on the page before the vendor types anything.
- [ ] Today's date is visually primary; other dates are reachable but not the default target.
- [ ] A check-in on the wrong day can be undone by the vendor or by an organizer.
- [ ] The email field says which email to use.
- [ ] The confirmation states a time a person would say aloud.
- [ ] Everything above holds at 390px, which is where this page is actually used.
