---
id: E29/F01/S03
title: The page at the door
type: story
status: in-progress
blocked_by: []
pr: []
---

## What

Attendance shows one market date at a time (today when it is one, else the next, else the last), "N of M checked in", All / Not yet / Checked in, a search by name, email or table, and per row the table in words, the vendor, "Not yet" or the time and who checked them in, and Check in or Undo for an editor.
Laptop first; at 390px the rows stack and nothing scrolls sideways (`meta.fitsAPhone`).

## Acceptance

- `e2e/the-door-on-market-day.spec.ts`: who has not come, finding one vendor, an organizer's check-in and undo, and the phone.
- The page joins the contrast sweep and the named-controls walk it was already in.
