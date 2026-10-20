---
id: E35/F02/S01
title: A search bar on the results
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

A search beside the results' date, section, tier and table filters, kept in the address with them.
It keeps the tables with a vendor assigned whose preferred name, full name, email, business email or business name matches, and the tables whose label matches.
It combines with the other filters and clears with "Clear all".

## As built

- "Identifying" is read as the names a vendor gave, their address, and their answers to the form's text and email questions (`SEARCHED_ANSWER_TYPES`).
  A business name, a business email and a handle are text answers; a choice, a number or a date is shared by many and finds nobody.
- `GET /markets/:id/tables` serves those words as `vendorSearch`, keyed by address beside `vendorNames` (`vendor_search_terms_for_market`).
  Only the vendors at a table are served, since the search finds tables, and an answer longer than 80 characters is left out (`SEARCHED_ANSWER_LENGTH`): a business name or a handle is short, and a description of their work would find everyone who mentions a word.
- The search is the `search` result filter (`?search=`), offered on the tables only, matched without case or surrounding spaces, and counted by the status pills.
  The address keeps it as typed, so the box can hold a space between two words.
- The test fake for applications now honours projections, dotted ones included, so a read that fetches too little fails here rather than in production.

## Acceptance criteria

- [x] Searching part of a vendor's full name, business name or email shows only their tables.
- [x] Searching a table label shows that table.
- [x] The search survives a reload and combines with a date filter.
