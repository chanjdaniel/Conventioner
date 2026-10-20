---
id: E31/F01/S03
title: Market Setup reads as settled
type: story
status: done
blocked_by: [E31/F01/S02]
pr: [#109]
---

## What to build

After draft, Market Setup is read-only with one line: "Settled when applications opened" (on the CSV path, "when you started collecting"), and how to change it while that is still possible.
No input on the page looks editable, and the floorplan flow opens read-only.

## Acceptance criteria

- [x] From `applications_open` on, on both paths, no Market Setup control accepts input, and the line says why.
- [x] While no application exists, the line says the market can go back to draft.
- [x] `every-control-is-named.spec.ts` and the contrast sweep still pass on the read-only page.

## Notes

The floorplan flow does not open as a read-only wizard: past draft its address says the setup is settled, in Market Setup's words, and leads back there.
Every step of the wizard writes the setup, so there was nothing for a read-only copy to show that Market Setup does not.
The settled line names the market's own path ("once you have started collecting" on the CSV path), and the way back to draft names each move from `applications_open` and from `applications_closed`.
