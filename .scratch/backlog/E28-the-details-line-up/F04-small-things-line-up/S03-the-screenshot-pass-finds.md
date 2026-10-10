---
id: E28/F04/S03
title: The screenshot pass's other finds
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

What the 2026-10-10 screenshot pass found clearly off on these screens, beyond the brain dump:

- **A locked "How vendors apply" choice is still legible.** Past draft the radios are disabled, and the chosen one is nearly invisible; only the card's border says which it is.
- **Web addresses in the vendor detail drawer are links.** Answers such as an Instagram address render as plain text there, though answers are meant to go through `AnswerValue`, which links `http(s)` addresses. Reproduce it first: if the drawer renders answers some other way, it moves to `AnswerValue`.

## Acceptance criteria

- [x] Past draft, the chosen intake mode is distinguishable from the other at a glance and meets 3:1 non-text contrast.
- [x] An `https://` answer in the vendor drawer is a link; a plain answer is not.
