---
id: E30/F02
title: The CSV import says where its decisions came from
type: feature
status: done
blocked_by: []
pr: []
---

## Outcome

An import that follows a form started from a CSV says that its mapping came from that start, and a value the start set aside is shown as set aside by the start, with how many rows it costs, before any row is skipped.

## Why now

The [walk](../../../wayfinding/what-to-show-and-when/walk/walk.md) imported `fall-2025.csv` after starting its form from the same file: the first import ever said "Restored from your last import", and 15 of 237 rows were skipped as "one you chose to ignore", which the organizer never chose.
The real November 2026 market is a CSV market.

## Stories

- `S01` - the import names the start, and shows what the start set aside.
