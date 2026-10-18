---
id: E30/F01/S02
title: No message describes a phase the market has left
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

Four messages the walk found describing the wrong phase:

- **Assignment in `applications_closed`** says "Applications are still being collected. Close them and review them first"; applications are closed. It says what is true there: review them, then begin assignment.
- **Assignment on an archived market** says "Change a single placement on the Result page instead", where nothing can be changed. It gives the archived reason.
- **The Application Form on an archived market** says it "can only be edited while the market is in draft phase. Current phase: Archived." It gives the archived reason.
- **Market Setup on an archived market** shows the archive sentence twice. Once.
- **Attendance on an archived market** labels vendors who never came "Not yet". Once the market is archived (or a date has passed), they read as not having come.

## Acceptance criteria

- [ ] Each of the five, in its phase, reads as above (walk screenshots `form-applications_closed-assignment`, `form-archived-*`).
- [ ] Unit tests pin the reason chosen per phase, so a phase added later picks a true one or fails.
