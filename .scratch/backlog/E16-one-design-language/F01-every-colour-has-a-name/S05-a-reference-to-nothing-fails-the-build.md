---
id: E16/F01/S05
title: A reference to nothing fails the build
type: story
status: done
blocked_by: [E16/F01/S01]
pr: [77]
---

## What to build

Two checks, because the failure mode this epic is about is **silence**.

**1. Custom-property resolution.** Every `var(--x)` referenced anywhere in `front-end/src` must resolve to a property something defines. About fifteen lines of Node diffing referenced properties against defined ones.

This is the check that matters most. `var(--mm-text-red)` is not a raw value a linter would object to - it is a well-formed reference to nothing, and it hid an invisible destructive button for as long as it existed. Stylelint cannot see it. Run it against the tree before writing the fix and confirm it reports `--mm-red` and `--mm-text-red`; a guard that does not fail on the bug it was written for is not a guard.

**2. A rendered-usage contrast sweep** in the Playwright suite: walk each screen, compute every text node's effective composited background through its ancestors, fail below its AA threshold.

Keep `contrast.test.ts` as well. It fails in milliseconds with a precise message when `base.css` changes; the sweep would only say "something on the Applications screen went dark".

**The sweep is only worth the states it walks.** A twenty-screen pass missed the invisible archive button because nobody opened that dialog. The sweep must deliberately open dialogs, menus, empty states and disabled states, and the list of states it visits is part of the deliverable.

## Acceptance criteria

- [x] The resolution check fails on a deliberately undefined property, and passes on `dev` once `S01` and `S02` have landed.
- [x] The contrast sweep reproduces the H3 failures on a branch where they are reverted.
- [x] The sweep's state list includes at least: the phase-rail menu and its confirm dialog, the manage-market dialog, the new-market dialog, the placement dialog, and one empty state.
- [x] Both run in CI on the same job as the rest of the front-end checks.

## Notes

Evidence: `.lavish/aesthetics-2026-09-20.html`, H0, H3, and the Method section's note on what a walk finds.
