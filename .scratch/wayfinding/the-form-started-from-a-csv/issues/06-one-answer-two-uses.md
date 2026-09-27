# 06: One answer, two uses

Type: grilling
Status: resolved
Blocked by: -

## Question

What each column is shapes the form and the plan, and becomes the saved import mapping (`import_mapping` on the market, restored by header text).
How exactly?

- The form is written in `draft`; the import runs in `applications_open` or `applications_closed`, usually on a later export of the same Google Form with more rows. What does the saved mapping hold so that import opens already mapped - and value resolutions too (the tier values, the dates written as headers)?
- What happens when the imported file's headers differ from the one the form started from: a question the organizer added to their Google Form afterwards, or reworded? Today the import's dead end is the form amendment; is that still the answer?
- Custom field keys are derived from labels; a Google Form question 300 characters long with notes in it makes a poor key and label. Is the label the header's first line, and is the rest help text (the Google Form's own words, not written by us)?
- Does the organizer's later edit to a form field (renaming it in the builder) keep its column mapping?

## Answer

Resolved 2026-09-27.

**Confirm saves the import's own mapping, through the import's own save path; nothing new is invented for it.**

1. **The mapping is the existing `ImportMapping`**, written by `csv_import.save_mapping` at confirm: `targets` (submitted at, applicant email, every essential the file answers and every new custom field's key, each to the header texts serving it), `headers` (the whole row, left-out columns included, so they are not "new" next time), and `resolutions` (every value fix: tier values, table choice sentences, max dates, and any plan disagreement the organizer settled). The first import of a later export opens with every column restored and every value matched.
2. **The grid's dates are saved as value fixes too**: the tier preference target's resolutions map each bracket text ("Monday, November 17") to the market date the confirmed year made of it, so the import never asks which date a column is.
3. **A later file that differs is handled as the import handles it today**: a question added to the Google Form afterwards is "new since last import" and reaches the form through the form amendment ("Add a question for it"); a reworded header is a saved target reported missing, mapped by hand. No fuzzy header matching.
4. **Label, help text and key come from the header, verbatim.** The label is the header's first line and everything after the first line break is help text; a first line over 120 characters keeps its first sentence (to the first "?" or ".") as the label and moves the rest into help text. The key is the label's slug, capped at 40 characters on a word boundary, `_2` and on for a duplicate. In the corpus 51 of 135 headers carry a line break and first lines run to 320 characters.
5. **A key edited or a field deleted is not tracked.** Renaming keeps the key (a loaded field's key is pinned, `keyTouched`), so the mapping survives; an edited key or a deleted question leaves a saved target that the import's restore skips, and the column shows as needing a mapping like any new one. A whole-form save cannot tell a rename from a delete and an add.
6. **Proposal** entered `CONTEXT.md`: what the product suggests a CSV's columns become, written nowhere until confirmed.

Built by [E24](../../../backlog/E24-the-form-started-from-a-csv/epic.md).
