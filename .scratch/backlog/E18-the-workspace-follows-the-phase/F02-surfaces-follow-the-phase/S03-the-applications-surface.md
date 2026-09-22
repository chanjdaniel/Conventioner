---
id: E18/F02/S03
title: The applications surface states which phase it is in
type: story
status: done
blocked_by: [E18/F02/S02]
pr: []
---

## What to build

One Applications surface serving three consecutive phases, which says in words which of them the market is in.

It carries the same two capabilities throughout - bring applications in, decide on them - and what changes is the emphasis and whether importing is offered:

- **Applications open** - leads with what has arrived; import offered.
- **Applications closed** - states that the market is no longer receiving; import still offered.
- **Review** - import withdrawn; leads with what is still undecided, and with the fact that every application must be decided before the market can assign.

The review queue itself is the same below all three.

## Why one surface

[Ticket 11](../../../wayfinding/the-order-of-the-work/issues/11-the-three-application-phases.md) measured the difference and found it small, and not the difference the phase names suggest:

- Recording a verdict has **no phase gate at all** - an organizer can approve and reject from the moment the first application lands. Review is the phase after which reviewing must be *finished*, not the one in which it happens.
- Importing spans applications-open and applications-closed, and stops only at review.
- Applications-closed changes nothing for a CSV market, where nothing was arriving in the first place.

Three screens would mean two near-identical screens on every market this product currently serves.

## The risk this story owes a debt to

The rail shows three steps while the workspace shows one place, which can read as the rail being decorative.
**The mitigation is the criterion**: the surface states its condition in words.
Hiding a button is not stating it, and the project has been caught by this before - a terminal state signalled only by strikethrough was read as "stopped" rather than "archived".

## Acceptance criteria

- [ ] One surface serves all three phases.
- [ ] In each phase it names its condition **in words**, not merely by which controls are present. An organizer who cannot tell applications-open from applications-closed by reading the screen fails this story.
- [ ] Import is offered in applications-open and applications-closed, and withdrawn in review - with the withdrawal explained, not silent.
- [ ] In review, the surface leads with the count still undecided and says that all must be decided before assignment.
- [ ] Recording a verdict works in all three phases, as it does today; this story must not add a phase gate that the back end does not have.
- [ ] The review queue's own contents are unchanged by this story - what a card shows is `E19`'s.
- [ ] Verified end-to-end by walking one market through all three phases and screenshotting each.
