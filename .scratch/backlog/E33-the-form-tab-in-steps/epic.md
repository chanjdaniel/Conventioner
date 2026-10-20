---
id: E33
title: The form tab in steps
type: epic
status: done
blocked_by: [E31]
pr: []
---

## Outcome

The organizer sets up a market's application form one step at a time, with a clear Next, and the form builder has the whole width.
Which steps there are follows the intake path: a market that takes applications online previews its form as an applicant sees it, and a Google Form market never shows a preview.
The organizer can say which answers reject an application automatically, and those applications reach review already rejected, with the reason.
No question is required unless the organizer said so.

## Why now

The [2026-10-19 brain dump](../../brain-dump/2026-10-19.md): the builder and the preview sit side by side and crowd each other, a form started from a Google Form marked questions required by a guess that skips real rows at import, and the real market has questions (the no-show agreement, the UBC affiliation) whose wrong answer is always a rejection.
Settled in the same day's grilling (decisions 5-8, 12, 24).
Feature work, so it waits for the November 2026 market window to close (2026-11-21).

## Features

- `F01` - the form is set up in steps.
- `F02` - no question is inferred required.
- `F03` - automatic rejections.

## Order inside this epic

`F01` first, since `F03`'s setup is its last step.
`F02` is independent.
`F03/S02` records an automatic reject as a verdict with a giver, which is `E34/F01/S01`.

## Out of scope

- Automatic rejection on free-text answers: choice answers only for now.
