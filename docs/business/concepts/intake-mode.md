---
layer: business
kind: concept
verified: 2026-10-22
---

# Intake mode

**Intake mode** is defined in [the glossary](../../../CONTEXT.md#organizing), under Organizing; this node gathers what the graph says about it.

## Rules

- [Intake mode decides how vendors arrive](../rules/intake-mode-decides-how-vendors-arrive.md): imported or applying online, exactly one, fixed after draft.
- [A gated market answers as absent](../rules/a-gated-market-answers-as-absent.md): a CSV market answers applicants as no market at all.
- [A vendor signs in before they have applied](../rules/a-vendor-signs-in-before-applying.md): how a vendor reaches a form market's application.
- [Publish Results waits for the allocation](../rules/publish-results-waits-for-the-allocation.md): a form market's step, which a CSV market has not.

## Flows

- [Creating a market](../flows/creating-a-market.md): the create-market dialog asks how vendors will apply.
- [How vendors apply](../flows/planning.md#e5-how-vendors-apply): the setting on Market Setup while the market is a draft.
- [The Google Form path](../flows/the-google-form-path.md), [the online path](../flows/the-online-path.md) and [the mixed path](../flows/the-mixed-path.md): one market per intake mode, and the mix that is not offered.
- [Starting from a Google Form's responses](../flows/starting-from-a-google-form.md) and [importing a Google Form's responses](../flows/import.md): the CSV path.
- [Applying online](../flows/applying-online.md): the form path.

## Implementation

- [ADR 0006: Intake mode fails closed](../../adr/0006-intake-mode-fails-closed.md): absence means `csv`.
- [The market document](../../implementation/data/market-document.md#the-fields-that-matter): `intakeMode`, and `market_from_document` withholding it.
- [The market guide](../../implementation/modules/market-guide.md): what each screen says per path.
- [The CSV import](../../implementation/modules/csv-import.md): the CSV path's in every phase.
- [The CSV proposal and start](../../implementation/modules/csv-proposal-and-start.md): a CSV market's form proposed from its file.
