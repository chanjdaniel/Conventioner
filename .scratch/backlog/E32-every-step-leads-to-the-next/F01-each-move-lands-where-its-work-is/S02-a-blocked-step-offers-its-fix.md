---
id: E32/F01/S02
title: A blocked step offers its fix as the main button
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

Today a refused move is drawn disabled, with its first blocker as a sentence and a "Fix it" link.
Instead, while the next step is refused and its first blocker names a page that resolves it, the rail's main button **is** that work ("Add a location", "Import responses"), taking the organizer to it; the refused move stays visible, disabled, beside it.
A blocker with nothing to click (a date that has passed) keeps today's sentence.
The verdicts still come from the server's blockers; nothing about whether a move is allowed is decided on the front end.

## As built

- Each guard names its own fix: `resolution_label` beside `resolution_link` on the blocker, both or neither, refused at construction, so the words live with the guard in `guards.py` and the front end stays generic. The blocker panel shown after a refused click names its link the same way.
- The review guard's fix reads "Finish deciding", the words the rail's sentence already used.
- On the page that holds the fix, no fix button is drawn: the work is already in front of the organizer, and a button there would lead nowhere. The move stays disabled with its reason.

## Acceptance criteria

- [x] A draft with no location shows "Add a location" as the main button, which opens Market Setup; the open-applications move is disabled beside it.
- [x] Once every blocker clears, the move itself is the main button.
- [x] A blocker with no page shows as a sentence, with no button.
- [x] Every main button has an accessible name, and the disabled move says why to assistive technology.
