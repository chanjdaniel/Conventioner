---
id: E35/F02/S01
title: A search bar on the results
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

A search beside the results' date, section, tier and table filters, kept in the address with them.
It keeps the tables with a vendor assigned whose preferred name, full name, email, business email or business name matches, and the tables whose label matches.
It combines with the other filters and clears with "Clear all".

## Acceptance criteria

- [ ] Searching part of a vendor's full name, business name or email shows only their tables.
- [ ] Searching a table label shows that table.
- [ ] The search survives a reload and combines with a date filter.
