---
id: E16/F01/S02
title: Nine reds and two blues become two tokens
type: story
status: done
blocked_by: [E16/F01/S01]
pr: [77]
---

## What to build

The product paints **nine distinct reds across 77 occurrences** for one semantic role, and two different blues for the same state seen from two screens.

| Red | Uses | White text on it |
| --- | --- | --- |
| `#cc0000` | 27 | 5.89 |
| `#d32f2f` | 18 | 4.98 |
| `#c0392b` | 11 | 5.44 |
| `#c62828` | 6 | 5.62 |
| `#e74c3c` | 5 | **3.82 fails** |
| `#b71c1c` | 4 | 6.57 |
| `#8a1f1f` | 4 | 9.14 |
| `#f44336` | 1 | **3.68 fails** |
| `#e53935` | 1 | **4.23 fails** |

The most-used of them was never chosen: `#cc0000` is the fallback in `var(--mm-red, #cc0000)`, standing in for the token `S01` defines. Twenty-four usages have been rendering a default this whole time.

Blues: `#3472d8` on the Markets phase badge and `#1b7ac5` on the triage card's `Open` badge are the same state - applications open - in two colours and two shapes.

Retire all of them onto `--mm-red` (`#c0392b`) and a new `--mm-blue` (`#1a6f8b`, 5.69:1, the same hue already in the palette as `--mm-text-link`). Delete every `var(--mm-red, #cc0000)` fallback: a fallback on a token that now exists is a second definition waiting to drift.

## Acceptance criteria

- [x] No hardcoded red or blue hex remains in `front-end/src` outside `base.css`.
- [x] No `var(--mm-*, <fallback>)` remains anywhere; a defined token needs no fallback and a fallback hides an undefined one.
- [x] The phase badges and the triage status badge use the same token for the same state.

## Notes

Blocked by `S01` only so the token exists first; they could land in one PR.
Evidence: `.lavish/aesthetics-2026-09-20.html`, S5, S7, H0.
