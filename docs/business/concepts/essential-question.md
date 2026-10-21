---
layer: business
kind: concept
verified: 2026-10-22
---

# Essential question

**Essential question** is defined in [the glossary](../../../CONTEXT.md#applying), under Applying, beside Full name, Offering, Required answer and Solver-relevant answer; this node gathers what the graph says about it.

## Rules

- [An incomplete application refuses the run](../rules/an-incomplete-application-refuses-the-run.md): an approved application must answer every asked essential question the market requires.
- [What an import may leave unasked](../rules/what-an-import-may-leave-unasked.md): the one essential answer an imported row may leave blank.
- [Intake mode decides how vendors arrive](../rules/intake-mode-decides-how-vendors-arrive.md): a CSV market still asks the essential questions, because they define the offering its CSV maps onto.
- [Tier filters, section prefers](../rules/tier-filters-section-prefers.md) and [table-share pairing](../rules/table-share-pairing.md): how the solver reads two of the answers.

## Flows

- [The essential questions](../flows/form-tab.md#f1-the-essential-questions): the form tab's first step.
- [Planning the market](../flows/planning.md): the plan the offering is derived from, and when it freezes.
- [Applying online](../flows/applying-online.md): a vendor answers them.
- [A required question has no column](../flows/import.md#h2d-a-required-question-has-no-column) and [stop asking a preference the form never asked](../flows/import.md#h2f-stop-asking-a-preference-the-form-never-asked): the import meeting them.
- [Review and adjust the proposal](../flows/starting-from-a-google-form.md#g4-review-and-adjust-the-proposal): a column becoming an essential question.

## Implementation

- [Essential fields](../../implementation/modules/essential-fields.md): asked, required, the offering and its freeze, the reserved prefix.
- [ADR 0001: Essential fields are exactly what the solver reads](../../adr/0001-essential-fields-are-the-solver-contract.md).
- [The market document](../../implementation/data/market-document.md#the-fields-that-matter): the frozen `essentialOptions` and `unaskedEssentials` on the form.
- [The application document](../../implementation/data/application-document.md): the answers under their reserved `essential_*` keys.
- [The CSV proposal and start](../../implementation/modules/csv-proposal-and-start.md): a column proposed as an essential question.
