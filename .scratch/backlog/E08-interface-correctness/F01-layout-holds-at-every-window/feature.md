---
id: E08/F01
title: Layout holds at every window size
type: feature
status: done
blocked_by: []
pr: [04215fc0]
---

## Outcome

The assignment statistics, the review queue and the Applications tab are readable and free of
spurious scrollbars from 1280x720 upward.

**Amended 2026-09-15.** This read "Every organizer screen is readable and free of spurious
scrollbars from 1280x720 upward", which overclaimed: the three stories below cover the statistics
lists, the `100vw` scrollbar and the Applications tab, and nothing else was examined. A second
journey walk (`.lavish/qc-2026-09-15.html`) found the **Tables view** clipping 1,942px of 2,762px
inside an `overflow: hidden` card that does not scroll - the same shape of bug as `S03` fixed here,
on a screen that was never a story. It is `E09/F02/S01`. The outcome is narrowed to what was
actually done so a later reader does not take it for a guarantee.

## Why now

Measured, not estimated. On the assignment results page the per-date/section/tier/table-choice lists
render **16px tall holding 266px of content** at 1280x720, 1366x768 and 1024x768; 21px at 1440x900;
35px at 1600x900. Only at 2560x1440 is the content essentially visible. The data is present and
correct in the DOM the whole time.

Cause: `.statistics-layout` and the grid below it are written for a definite height flowing down from
an ancestor (`flex:1`, `min-height:0`, rows of `minmax(0,1fr)`), and no ancestor supplies one, so
`.stat-list` collapses toward zero. `front-end/src/views/GenerateAssignmentView.vue:808-845`.
