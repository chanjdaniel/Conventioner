---
layer: business
kind: concept
verified: 2026-10-22
---

# Review highlight

**Review highlight** is defined in [the glossary](../../../CONTEXT.md#applying), under Applying; this node gathers what the graph says about it.

## Rules

- [Review highlights](../rules/review-highlights.md): where they live, who changes them, and what the card does with them.
- [What each role may do](../rules/what-each-role-may-do.md): the highlights are an Editor's.
- [An archived market is read-only](../rules/an-archived-market-is-read-only.md): an archived market's highlights do not change.

## Flows

- [What a reviewer reads first](../flows/form-tab.md#f3-what-a-reviewer-reads-first): the organizer marks them on the form tab's Review setup.
- [Work through the queue](../flows/review.md#i1-work-through-the-queue) and [choose what leads the card](../flows/review.md#i3-choose-what-leads-the-card): the review card leads with them, and edits them in place.

## Implementation

- [The market document](../../implementation/data/market-document.md#the-fields-that-matter): `reviewHighlights`, on the market rather than the form.
- [ADR 0008: Each write names what it changes](../../adr/0008-each-write-names-what-it-changes.md): `PUT /markets/:id/review-highlights` is their own write.
