---
id: E29/F01
title: Attendance knows who is missing
type: feature
status: in-progress
blocked_by: []
pr: []
---

## Outcome

Attendance lists, for one market date at a time, every vendor the stored assignment places that day, with their table and whether and when they checked in, counted and filterable; an editor can check a vendor in or undo it from that list.

## Stories

- `S01` - the roster: `GET /markets/:id/attendance` serves every placed vendor per date, from the stored assignment, with check-in time and who made it.
- `S02` - an organizer checks a vendor in: `POST`/`DELETE /markets/:id/attendance`, EDITOR, in `market_days` only, recording `checked_in_by`.
- `S03` - the page: one date at a time (today when it is a market date), "N of M checked in", All / Not yet / Checked in, search, Check in and Undo per row; a table on a laptop, stacked rows on a phone.
