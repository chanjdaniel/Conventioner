---
id: E31/F04/S04
title: Notes where the vendor is looked at, and a request marked handled
type: story
status: in-progress
blocked_by: [E31/F04/S01, E31/F04/S02]
pr: []
---

## What to build

On the applications review, the assignment's Vendors page and the attendance roster, a vendor's row carries a compact marker when any kind of note exists; expanding it shows each kind under its own label (their request, your note, from your sheet).
The organizer's note is written wherever it is shown.
A request can be marked handled by EDITOR and up, and the mark taken back if it was wrong; the roster shows each request as outstanding or handled, so the door can tell "needs a chair" from "already got one".

## Acceptance criteria

- [x] All three pages show the marker and the labelled kinds.
- [x] The note saves from each page.
- [x] Marking a request handled shows on the roster at desktop width and at 390px.
- [x] `every-control-is-named.spec.ts` walks a row with each kind of note present.
