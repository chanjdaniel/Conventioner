---
id: E31/F03/S01
title: Creating a market asks how vendors will apply
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

The create-market dialog asks "How will vendors apply?" (on this market's page, or on my own Google Form), with nothing preselected, and the market is created with that intake mode.
It stays changeable on Market Setup while the market is a draft.
The server's fail-closed default (absent means `csv`) stays for any market without an answer; no new market relies on it.

## Acceptance criteria

- [ ] The dialog cannot be submitted without an answer; Enter respects that (AppDialog's contract).
- [ ] Each answer creates a market of that path.
- [ ] Market Setup's intake card no longer shows a choice the organizer never made.
