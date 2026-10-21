---
layer: business
kind: concept
verified: 2026-10-21
---

# Table sharing

**Table sharing** is defined in [the glossary](../../../CONTEXT.md#placing), under Placing, beside Table choice and Placed as; this node gathers what the graph says about it.

## Rules

- [Table-share pairing](../rules/table-share-pairing.md): one-way is enough, a person's own request outranks one about them, the first applicant named.
- [The half-table share](../rules/half-table-share.md): the organizer's share of a section on half tables.

## Flows

- [The essential questions](../flows/form-tab.md#f1-the-essential-questions): the table choice and the table-share partner on the form.
- [Work through the queue](../flows/review.md#i1-work-through-the-queue): a table-share request that needs attention shows on the review card.
- [The vendor drawer](../flows/vendor-drawer.md): the same notice on a vendor's application.
- [Assignment options](../flows/assignment-and-result.md#j2-assignment-options): the half table proportion per section.

## Implementation

- [The assignment solver](../../implementation/modules/assignment-solver.md): `get_valid_vendors`, who fills the other half of a table.
- [Essential fields](../../implementation/modules/essential-fields.md): how the partner's address is read out of the answer.
- [The assignment behaviour suite](../../implementation/testing/assignment-behaviour-suite.md): the pairing and the share, pinned case by case.
