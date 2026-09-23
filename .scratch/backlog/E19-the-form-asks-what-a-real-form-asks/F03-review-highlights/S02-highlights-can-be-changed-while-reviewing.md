---
id: E19/F03/S02
title: Highlights can be changed while reviewing
type: story
status: done
blocked_by: [E19/F03/S01]
pr: []
---

## What to build

A reviewer changes which answers lead the card **from the review queue itself**, without leaving it and without reopening the form.

The card re-renders immediately, and the change sticks for the rest of the queue and for anyone who reviews it next.

## Why this is the point of the whole feature

An organizer authoring a form is guessing what will matter.
A reviewer on card twelve **knows** - and by then the form has frozen, because an application exists.

Storing the list on the market rather than on the form is what makes this possible.
`S01` put it there; this story is the reason it went there.
Without this, the feature is a guess an organizer makes once and cannot correct.

## Acceptance criteria

- [x] A reviewer can mark and unmark answers from the review queue, and the current card updates immediately.
- [x] The change is stored on the market, in the same place the form builder writes, and is visible to the next person who opens the queue.
- [x] It works **after** applications exist and the form has frozen - which is the case this story is for. Verify specifically on a market whose form is locked.
- [x] Marking from the queue and marking from the form builder read and write one list; there is no second store and no divergence.
- [x] The queue's position is not lost when the marks change - a reviewer on card twelve stays on card twelve.
- [x] Verified end-to-end on a market with a frozen form: change the marks mid-queue, confirm the card changes and that reopening the queue shows the new marks.
