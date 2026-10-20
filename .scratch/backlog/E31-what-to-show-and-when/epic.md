---
id: E31
title: What to show, and when
type: epic
status: done
blocked_by: []
pr: []
---

## Outcome

At every phase of a market, the organizer can see what to do now and what comes next without knowing the product, and the market's two intake paths each read as their own sequence.
The setup is settled before vendors arrive and cannot drift under them; the rail states the next step and why it cannot be taken yet, before the click; each path has its own tabs and words; and the organizer and the vendor each have a place for what a vendor needs beyond a table.

## Why now

The [2026-10-18 brain dump](../../brain-dump/2026-10-18.md): many features work, but the UI does not say what to do and when.
Every decision is in the closed map [What to show, and when](../../wayfinding/what-to-show-and-when/map.md); its [walk](../../wayfinding/what-to-show-and-when/walk/walk.md) found the screens offering what the market cannot do yet and refusing only after the click.
This is feature work, so it waits on its branch until the November 2026 market window closes (2026-11-21); [E30](../E30-what-the-walk-found/epic.md) is what ships inside the window.

## Features

- `F01` - the setup is settled on leaving draft.
- `F02` - the rail says what to do now.
- `F03` - each path has its own tabs and words.
- `F04` - vendor notes.

## Order inside this epic

`F01/S01` and `F02/S01` first: the complete-setup guard is one of the verdicts the rail serves.
`F02/S02` (the one table) before `F03`, which reads it.
`F04` is independent of the rest.

## Out of scope

- The phases and how they are tracked.
- Amending the setup after it is settled (a venue that changes): a future feature, built when a real market needs it.
