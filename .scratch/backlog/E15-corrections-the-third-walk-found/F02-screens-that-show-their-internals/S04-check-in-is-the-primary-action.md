---
id: E15/F02/S04
title: Check in is the primary action
type: story
status: done
blocked_by: []
pr: [77]
---

## What to build

**Half of this story's premise was wrong, and the code was right.** Corrected 2026-09-20 while implementing it.

`Check in` is already `primary-button` on the row whose date is today, and `secondary-button` on every other row:

```
:class="row.date === today ? 'primary-button' : 'secondary-button'"
```

The walk measured a market whose dates were all in the future, so every row rendered secondary and the screenshot showed only outline buttons. `AttendanceCheckinView` already carries the reasoning: *"Today is the one a vendor at the door means. It is not merely styled differently: every other day's button is secondary, so a mis-tap takes a deliberate press on a control that does not look like the primary one."* That is better than what this story proposed - "`Check in` becomes the solid primary" on every row would make a mis-tap on the wrong day exactly as easy as the right one.

**What is left, and is genuinely wrong:** `Look up` stays solid green after the lookup has succeeded, so on the result view it competes with the day's own action. It demotes to secondary once a summary is showing.

The 390px rendering is otherwise the best-executed surface in the product - no horizontal scroll, no overflowing element, no contrast failure - so change the emphasis, not the layout.

## Acceptance criteria

- [x] `Look up` is primary before a lookup and secondary after one.
- [x] On the result view, the only primary control is `Check in` for today - and when today is not a market day, there is no primary control at all, which is correct: nothing on that screen is the thing to press.
- [x] The check-in e2e spec asserts which control is primary, not just that it exists.
- [x] 390px still reports no horizontal scroll and no contrast failure.

## Notes

Startable now.
This is the one finding from the "organization" group that carries no decision - the primary action being the primary button is not a matter of taste. The rest of that group is deliberately not started; see the epic.
Evidence: `.lavish/aesthetics-2026-09-20.html`, O4.
