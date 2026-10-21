---
layer: business
kind: intent
verified: 2026-10-21
sources:
  - E01
  - E24
  - E19/F01
  - E26/F02
---

# Vendors come in from the organizer's own Google Form

An organizer who already collects applications with their own Google Form keeps it, and runs the market from its responses.
They start the market from those responses, so the plan's dates and tiers and the form's questions are proposed from the columns they already have, and they say once what each column is.
Each response they import becomes an application, the same record a vendor applying on the market's own page makes, so the review, the assignment and the door never ask which way a vendor came in.
A real export imports whole, a second import of the same file changes nothing, and the import writes only what it said it would.
The market's own form asks for dates and tiers in the one grid such a form asks, so both ways in store one shape of answer.

## Why

The organizers who run real markets already have a Google Form and a sheet of its responses; a product that made them abandon it, or retype its questions so an import has somewhere to put each column, would not be used.
Saying what each column is should happen once, at the start, not again at every import.
One record for both ways in is what lets everything after intake be built once: switching a market to applying online needs no new assignment, review or door.
And an import that silently drops or rewrites what a vendor answered would put a wrong answer in front of the solver, where nobody sees it until a vendor is seated wrongly.

## Rules

- [Intake mode decides how vendors arrive](../rules/intake-mode-decides-how-vendors-arrive.md): a market imports, or takes applications online, exactly one, chosen at creation.
- [No question is inferred required](../rules/no-question-is-inferred-required.md): a market started from the responses proposes every question optional, so no applicant is dropped by a guess.
- [What an import may leave unasked](../rules/what-an-import-may-leave-unasked.md): what an imported row may leave blank, and what it may not.
- [An imported email is asserted](../rules/an-imported-email-is-asserted.md): an imported address is the organizer's word, not proven by the vendor.
- [Review needs an import](../rules/review-needs-an-import.md): the import is this path's collection, and the moves around review are the import's.
- [The form locks at the first application](../rules/the-form-locks-at-the-first-application.md): the first imported row fixes the form, as the first application online does.
- [Tier filters, section prefers](../rules/tier-filters-section-prefers.md): the per-day tier answer the form's grid asks is a promise the solver never breaks.

## Flows

- [The Google Form path](../flows/the-google-form-path.md): the whole path, from creation to the end.
- [Creating a market](../flows/creating-a-market.md): "On my own Google Form" puts the market on this path from its first screen.
- [Starting from a Google Form's responses](../flows/starting-from-a-google-form.md): the plan and the questions proposed from the file, and confirmed.
- [Importing a Google Form's responses](../flows/import.md): the import's four steps, and every branch of them.
- [Building the application form](../flows/form-tab.md): the questions, and the one grid of dates and tiers.
- [The mixed path](../flows/the-mixed-path.md): importing beside applying online, and why it is not offered.
