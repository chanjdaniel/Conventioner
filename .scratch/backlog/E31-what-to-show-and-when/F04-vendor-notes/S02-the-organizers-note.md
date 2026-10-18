---
id: E31/F04/S02
title: The organizer's note
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

One editable text per vendor on a market, shared by its organizers, stored with who last edited it and when.
Every role on the market reads it; EDITOR and up write it, through a write of its own that loads through the change loader (so an archived market refuses it); the vendor never sees it, on any applicant surface.
It is deleted with the market's other records (`market_deletion.py`).

## Acceptance criteria

- [ ] EDITOR writes, VIEWER reads and cannot write, an applicant endpoint never returns it.
- [ ] An archived market refuses a write.
- [ ] Deleting the market deletes its notes.
