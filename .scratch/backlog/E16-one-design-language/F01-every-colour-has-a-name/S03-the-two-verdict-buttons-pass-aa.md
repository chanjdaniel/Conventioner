---
id: E16/F01/S03
title: The verdict buttons and the phase label pass AA
type: story
status: done
blocked_by: [E16/F01/S02]
pr: [77]
---

## What to build

Three contrast failures, all on screens an organizer works in earnest.

**The triage verdict buttons.** A reviewer meets these once per application - 232 times for the real UBC export.

| Control | Ground | Ratio | Needs |
| --- | --- | --- | --- |
| `Skip` | `--mm-border` over white | **1.74:1** | 4.5 |
| `Reject` | `#F44336` | **3.68:1** | 4.5 |
| `Approve` | `#3A853D` | 4.56:1 | 4.5 |

`Skip` uses `--mm-border` as a *fill* with white text on it. `base.css` exempts that token from the contrast contract on the stated grounds that it "never carries text", and `contrast.test.ts` asserts tokens rather than usages, so the test could not see it. The same `rgba(39,35,35,.25)`-with-white-text pattern is the disabled state of `Create market`.

Note that Approve clears the bar by 0.06: all three were coloured without the contract in view and one happened to land on the right side of it.

**The phase label.** `--mm-green` measures 4.59:1 on white and **4.43:1** on the phase rail's `#FBFBFA`, where it is the current-phase label on every market screen. Either the rail's ground becomes white or the label takes a darker value - a token is only AA on the grounds it was measured against.

## Acceptance criteria

- [x] Every verdict button, its keyboard-shortcut chip, and the current-phase label reach 4.5:1 as rendered.
- [x] `--mm-border` is not used as a fill under text anywhere.
- [x] `base.css`'s comment about `--mm-border` is amended: "never carries text" is now enforced rather than assumed.
- [x] Disabled controls reach 4.5:1 too, or are given a treatment that does not rely on text contrast alone.

## Notes

Evidence: `.lavish/aesthetics-2026-09-20.html`, H3, H4.
