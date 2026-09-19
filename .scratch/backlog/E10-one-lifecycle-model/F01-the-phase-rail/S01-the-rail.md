---
id: E10/F01/S01
title: The rail
type: story
status: in-progress
blocked_by: []
pr: [73]
---

## What to build

`PhaseControlPanel` is replaced by a rail rendered as a band directly below the market header,
inside the card, on every market screen.

**The spine.** Seven phases in order - draft, applications open, applications closed, review,
assignment, market days, archived - with the market's position marked and completed stages filled.
`offers` is not on it.
Derive the sequence from the existing front-end mirror of `VALID_TRANSITIONS`, not a second list.

**The actions.** One prominent forward action; back and destructive edges behind a secondary menu.
Deriving "which is forward" from the transition table rather than from
`transitionVariant()`'s special cases removes the bug where `draft` - the one unambiguously
backwards edge - falls through to `advance`.

**The frozen state.** A market that left the spine freezes at the last stage it reached, **and says
in words what became of it**. The prototype proved strikethrough alone reads as *stopped*, not
*archived*: a reader cannot tell a deliberately-stopped rail from a broken one. Words are the fix;
the strikethrough stays as reinforcement.

**The label.** `PhaseControlPanel` renders "Current Phase:" in `rgba(255,255,255,.7)` on a white
page, invisible. Whatever the rail's equivalent is, it is legible - see `E09/F01/S02`, which carries
the same defect and should be closed by this if it lands first.

## Acceptance criteria

- [x] The rail appears below the header on every market screen, in every phase.
- [x] At 1920x1080 with a 60+ character check-in URL, no two adjacent phase labels overlap.
      Test by comparing adjacent label bounding boxes: container overflow does **not** detect this,
      because the step boxes shrink below their labels.
- [x] Forward, backward and destructive are distinguishable, and `Reopen for Editing` is not
      presented as an advance.
- [x] An archived market's rail states in words that the market is over, and why where known.
- [x] Every label on it is legible per `E09/F01/S01`.
- [x] The phase strip that floats above the card is gone, not merely restyled.
