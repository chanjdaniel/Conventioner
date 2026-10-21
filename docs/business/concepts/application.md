---
layer: business
kind: concept
verified: 2026-10-22
---

# Application

**Application** is defined in [the glossary](../../../CONTEXT.md#applying), under Applying; this node gathers what the graph says about it.

## Rules

- [A vendor signs in before they have applied](../rules/a-vendor-signs-in-before-applying.md): the first valid save creates the application.
- [The form locks at the first application](../rules/the-form-locks-at-the-first-application.md): the first application fixes the form.
- [What an import may leave unasked](../rules/what-an-import-may-leave-unasked.md): an imported row may leave the number of dates unanswered.
- [Verdicts settle on entering assignment](../rules/verdicts-settle-on-entering-assignment.md): when a verdict on an application can still change.
- [An applicant never reads a verdict early](../rules/an-applicant-never-reads-a-verdict-early.md): what the applicant reads of their own application.
- [An incomplete application refuses the run](../rules/an-incomplete-application-refuses-the-run.md): an approved application missing an asked answer stops the assignment.
- [A seat only for an applicant](../rules/a-seat-only-for-an-applicant.md): a seat goes only to someone with an application.
- [Adding a vendor who never applied](../rules/adding-a-vendor-who-never-applied.md): the one way to give someone an application by hand.

## Flows

- [Applying online](../flows/applying-online.md): a vendor applies, edits, and reads their outcome.
- [Importing a Google Form's responses](../flows/import.md): one application per row of a CSV.
- [Taking applications](../flows/taking-applications.md): opening and closing applications on the online path.
- [Reviewing applications](../flows/review.md): the verdicts, one by one and All.
- [Vendors](../flows/vendors.md) and [the vendor drawer](../flows/vendor-drawer.md): every applicant by vendor, and one vendor's application.

## Implementation

- [The application document](../../implementation/data/application-document.md): one per applicant per market, its answers and review state.
- [The CSV import](../../implementation/modules/csv-import.md): one row per applicant, written through the applications API.
- [ADR 0003: Applications are the solver's only input](../../adr/0003-applications-are-the-solvers-only-input.md).
- [ADR 0011: A re-import upserts on the market and the address](../../adr/0011-re-import-upserts-on-market-and-email.md): what a later export does to the applications already here.
