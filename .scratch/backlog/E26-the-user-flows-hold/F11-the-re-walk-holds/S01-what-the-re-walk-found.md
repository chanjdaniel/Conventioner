---
id: E26/F11/S01
title: What the re-walk found
type: story
status: done
blocked_by: []
pr: [88]
---

## What to build

The defects the live re-walk of 2026-10-03 met on P1 to P3, each reproduced first as a failing Playwright spec, then fixed.

Closes bugs 48 to 53 in `docs/MVP_BUGS.md`.

## Acceptance criteria

- [x] An import row whose only answers to a required question were ones the organizer chose to ignore says so, and a blank row says it is blank (bug 48).
- [x] A web address in an answer is a link on the review card and on the vendor's own page, and only `http` and `https` ever become one (bug 49).
- [x] Every control in a priority rule has a name, removing a rule or an answer is a button, and each calendar day is named by its date (bug 50).
- [x] The check-in email field is the height of the button beside it on a phone (bug 51).
- [x] No link is padded off its line, native checks and radios are the product's green, and "Plan saved" stands in the plan's gutter (bug 52).
- [x] The vendor's Full name asks for the official name (bug 53).
