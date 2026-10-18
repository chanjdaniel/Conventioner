---
id: E29/F01/S01
title: The roster
type: story
status: in-progress
blocked_by: []
pr: []
---

## What

`GET /markets/:id/attendance` serves `{dates, roster}`: every vendor the stored assignment places, per market date, with name, table, side, section, location, `checkedInAt` and `checkedInBy`, sorted by date then table.

## Acceptance

- A vendor placed but not checked in is listed (`tests/test_the_door.py`).
- The roster is read off the stored assignment, the rows check-in records against.
