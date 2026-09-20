---
id: E15/F02/S02
title: The form-lock banner names the phase in words
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

The Application Form tab's lock banner reads:

> Application form can only be edited while the market is in draft phase. Current phase: market_days.

`market_days` is the stored enum value.
The phase rail, two inches above it on the same screen, names that state **Market Days**.
One screen, one state, two spellings, one of them snake_case.

The rail already has the mapping from phase to label. Read it from wherever the rail reads it rather than adding a second copy - two copies of a phase-to-label map is exactly the drift `AGENTS.md` warns about for the phase spine.

Sweep for siblings while here: any other surface printing a raw phase, status or enum value.

## Acceptance criteria

- [ ] The banner names the phase the way the rail names it.
- [ ] No organizer-facing string contains a raw `snake_case` enum value. Asserted by a test that walks the market screens for `/[a-z]+_[a-z]+/` in visible text.
- [ ] There is one phase-to-label mapping in the front end, not two.

## Notes

Startable now.
Evidence: `.lavish/aesthetics-2026-09-20.html`, H6.
