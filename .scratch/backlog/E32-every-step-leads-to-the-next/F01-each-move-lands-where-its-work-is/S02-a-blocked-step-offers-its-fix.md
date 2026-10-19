---
id: E32/F01/S02
title: A blocked step offers its fix as the main button
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

Today a refused move is drawn disabled, with its first blocker as a sentence and a "Fix it" link.
Instead, while the next step is refused and its first blocker names a page that resolves it, the rail's main button **is** that work ("Add a location", "Import responses"), taking the organizer to it; the refused move stays visible, disabled, beside it.
A blocker with nothing to click (a date that has passed) keeps today's sentence.
The verdicts still come from the server's blockers; nothing about whether a move is allowed is decided on the front end.

## Acceptance criteria

- [ ] A draft with no location shows "Add a location" as the main button, which opens Market Setup; the open-applications move is disabled beside it.
- [ ] Once every blocker clears, the move itself is the main button.
- [ ] A blocker with no page shows as a sentence, with no button.
- [ ] Every main button has an accessible name, and the disabled move says why to assistive technology.
