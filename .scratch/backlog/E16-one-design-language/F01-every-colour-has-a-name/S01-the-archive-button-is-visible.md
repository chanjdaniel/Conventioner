---
id: E16/F01/S01
title: The Archive button is visible
type: story
status: done
blocked_by: []
pr: [77]
---

## What to build

`--mm-text-red` is **never defined**. It is not in `base.css`, and `getPropertyValue('--mm-text-red')` on `:root` returns the empty string. Seven rules reference it with no fallback, and each fails silently in its own way:

| Rule | Declared | Computes to | Why |
| --- | --- | --- | --- |
| `.confirm-archive-button` | `background: var(--mm-text-red)` | `rgba(0,0,0,0)` | invalid at computed-value time, resets to initial |
| `.confirm-archive-button` | `border: 1px solid var(--mm-text-red)` | `0px` | shorthand invalid, whole declaration dropped |
| `.confirm-archive-button` | `color: white` | white | valid, so white text survives onto a white dialog |
| `.rail-menu-item--end` | `color: var(--mm-text-red)` | `rgb(44,62,80)` | invalid, so `color` inherits from `body` |
| `.phase-rail-error` | `color: var(--mm-text-red)` | inherited | rail errors are not red |
| `PlacementDialog.vue` x3 | colour and border | inherited / dropped | |

The visible result: the dialog that says *"Archiving is permanent. Once archived, a market cannot be returned to an active phase. This action cannot be undone."* appears to offer exactly one option, **Cancel**. The Archive button is present and clickable at 75x36 immediately left of it, and every pixel inside its box measures `(255,255,255)`.

The comment directly above `.rail-menu-item--end` reads *"Destructive reads as destructive wherever it appears."* It does not.

Two more things in that dialog while you are in it: its heading `Archive this market?` is set in `--mm-green`, the product's affirmative colour, on a permanent destructive confirmation.

Define `--mm-red: #c0392b` (white text on it: 5.44:1) in `base.css` and point the seven broken usages at it. See `docs/design-system.md`, "Colour".

## Acceptance criteria

- [x] The Archive confirmation button renders with a visible fill and readable label, asserted by computed style *and* by a pixel check that its box is not uniformly the dialog's background.
- [x] `Archive Market` in the rail menu renders in `--mm-red`, distinct from `body` colour.
- [x] `.phase-rail-error` and the three `PlacementDialog` usages resolve.
- [x] The confirm dialog's heading is not `--mm-green`.
- [x] An e2e test opens this dialog. It was missed by a twenty-screen walk because nobody opened it.

## Notes

Startable now, and the most urgent story in either epic.
Evidence: `.lavish/aesthetics-2026-09-20.html`, H0.
