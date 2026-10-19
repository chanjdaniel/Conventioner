---
id: E32/F01/S01
title: A move lands on the new phase's page
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

When a move from the rail succeeds, the organizer is taken to the page the guide's table names for the phase the market is now in (the same answer the market's landing page and the rail's current-page dot already read).
This holds for every move: forward, back, and the moves in the rail's menu.

Reproduce each case end to end in the browser first, as an organizer would hit it:

- On a Google Form market, after an import, **Begin Review** leaves the import page and its "Imported 197 new applications, 15 rows skipped" result on screen. Find whether the review was there but hidden, or the move did not land; the fix is that the organizer arrives at the review with no stale import result.
- **Begin Assignment** moves the phase and leaves the organizer on the applications page.
- **Publish Market** moves the phase and does not reach Attendance.

## Acceptance criteria

- [x] Begin Review lands on the review, with no import result left on screen.
- [x] Begin Assignment lands on the assignment page.
- [x] Publish Market lands on Attendance.
- [x] A back move from the rail's menu lands on its phase's page too.
- [x] Where the organizer lands is read from the guide's table, not restated per move.
- [x] An E2E spec walks each of the three forward moves and asserts the page arrived at.
- [x] The page arrived at starts at its top, wherever the organizer had scrolled to on the page they left.
