---
id: E30
title: What the walk found
type: epic
status: ready
blocked_by: []
pr: []
---

## Outcome

What an organizer reads on a market's screens is true in every phase: no page errors on a fresh draft, no message describes a phase the market has left, no link is cut off or points at the wrong page, nothing is offered that can never succeed, and the CSV import says where its decisions came from.

## Why now

A walk of both intake paths through every phase on 2026-10-18 ([walk.md](../../wayfinding/what-to-show-and-when/walk/walk.md)) found these while grounding the [What to show, and when](../../wayfinding/what-to-show-and-when/map.md) map.
None carries a decision, so they skipped the map.
Every story is a `fix:` and carries no migration, so they may merge during the November 2026 market window (2026-10-18 to 2026-11-21), each promoted once green (`docs/RELEASING.md#hotfixes`).
`F02/S01` comes first: the real market is a CSV market, and its import skipped rows the organizer never chose to drop.

## Features

- `F01` - the screens say true things in every phase. Startable now.
- `F02` - the CSV import says where its decisions came from. Startable now.

## Order inside this epic

Every story is independent; `F02/S01` first.

## Out of scope

- Anything [E31](../E31-what-to-show-and-when/epic.md) reworks: which step the rail offers, the setup freeze, the per-path words and tabs, and what Result shows before a run.
- The Vue DevTools pill in the walk's screenshots: development only.
