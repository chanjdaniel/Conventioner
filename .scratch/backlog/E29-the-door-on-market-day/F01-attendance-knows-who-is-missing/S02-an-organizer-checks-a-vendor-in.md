---
id: E29/F01/S02
title: An organizer checks a vendor in
type: story
status: in-progress
blocked_by: []
pr: []
---

## What

`POST` and `DELETE /markets/:id/attendance` with `{vendorEmail, date}` (`api/door.py`): EDITOR and up, in `market_days` only (409 otherwise), refused on an archived market; the check-in records `checked_in_by`.

## Acceptance

- A viewer is refused; a draft, review or assignment market answers 409; an archived market is refused.
- A vendor not placed that day cannot be checked in.
- A vendor checking in again after an organizer clears the organizer's name.
