---
id: E09/F01/S01
title: The palette meets AA
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

The audit is done - [ticket 03](../../../wayfinding/readable-journey/issues/03-contrast-contract-on-tokens.md)
carries the full table. This applies it.

**Split `--mm-grey` by role.** It is overwhelmingly a border colour that 18 sites borrow as text:

- **`--mm-border`** - `rgba(39,35,35,.25)`, unchanged, the 57 border and background sites.
- **`--mm-text-muted`** - alpha **0.63**, composites to `#777474`, ratio **4.63** on white, the 18
  text sites.

**Fix the failing text colours.**

| Token | Today | Where it fails |
| --- | --- | --- |
| `--mm-yellow` `#e4a629` | **2.15** | 4 text sites, and white-on-yellow badges |
| `--mm-green` `#49b096` | **2.65** | 18 text sites, and white-on-green on every primary button |
| `--vt-c-text-light-2` `rgba(60,60,60,.66)` | **4.06** | a near miss, fails 4.5 for normal text |
| `#2196F3` | **3.12** | the "Forgot password?" link, hardcoded, not a token |

`--mm-green` and `--mm-yellow` keep their value as **fills**; what is needed is a darker variant for
white text on them and for text on white. `#2196F3` becomes a token or adopts the green.

**Two families.** On-light and on-dark are separate. One muted grey cannot serve both grounds, and
pretending it can is how `PhaseControlPanel` came to paint `rgba(255,255,255,.7)` on a white page
(`S02`).

Raising the muted grey is a **visible** change to the product's texture on every screen. It will read
heavier. That is accepted; if the heavier look is wrong the answer is a different hue at a passing
contrast, never a lower standard.

`--mm-black` is declared twice in the same block; delete one.

## Acceptance criteria

- [ ] Every token whose name says it is text reaches 4.5:1 on white and on `--mm-beige`, or 3:1
      where used only at 18px+ or 14px bold.
- [ ] White text on `--mm-green` and on `--mm-yellow` reaches 4.5:1.
- [ ] The 57 border uses of the old grey are unchanged in value.
- [ ] No hardcoded colour remains where a token belongs.
- [ ] `--mm-black` is declared once.
