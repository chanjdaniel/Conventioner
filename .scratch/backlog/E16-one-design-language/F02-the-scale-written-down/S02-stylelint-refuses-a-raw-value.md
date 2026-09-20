---
id: E16/F02/S02
title: Stylelint refuses a raw value
type: story
status: done
blocked_by: [E16/F02/S01]
pr: [77]
---

## What to build

Stylelint, wired into the same CI job as `format:check`, banning outside `base.css` and the primitive files:

- raw hex colours
- raw `font-size`
- raw `border-radius`
- raw `box-shadow`

The existing violations are the migration, not this story's problem: **start the rules as warnings, with the four slice features (`F04`-`F07`) flipping them to errors one directory at a time as each slice lands.** A rule that fails the build on 351 pre-existing violations gets disabled within a week, which is the outcome this epic exists to avoid.

Spacing is deliberately not linted. A raw `padding: 10px` is indistinguishable to a linter from a legitimate one-off, and 32 values cannot be mechanically sorted into 7. Spacing conforms slice by slice, by judgement.

## Acceptance criteria

- [x] Stylelint runs in CI and reports the existing violations as warnings.
- [x] A new raw hex, font-size, radius or shadow in a file already migrated fails the build.
- [x] `base.css` and the primitive files are exempt, and the exemption is a named list rather than a glob that will quietly grow.

## Notes

Evidence: `.lavish/aesthetics-2026-09-20.html`, S1-S4.
