---
id: E10/F04/S03
title: Publish Results follows intake mode
type: story
status: in-progress
blocked_by: []
pr: [71]
---

## What to build

`Publish Results` flips `resultsPublished`, which is what makes a reviewer's verdict visible to the
applicant instead of `under_review`.
The label is correct for what it does.

But every endpoint that reads the flag - `get_public_application_form`, `get_applicant_application`,
`save_applicant_application` - goes through `applicant_intake_market_by_slug`, which serves
**form-intake markets only**, and intake mode defaults to `csv` with no UI to change it.
On every market this product can currently create, **the flag has no reader** and the button is a
no-op with a confident label.

Condition it on intake mode: present on form markets, absent on CSV.
It therefore disappears from MVP in practice, which is the honest outcome, while the code keeps the
concept rather than losing it and having to re-derive it later.

The condition belongs beside the existing gate, not as a fourth check somewhere new - `AGENTS.md` is
explicit that the single-lookup shape exists because "five checks are five chances to forget the
sixth".

## Acceptance criteria

- [ ] A CSV-intake market offers no Publish Results control.
- [ ] A form-intake market offers it, disabled with its reason when nothing has been reviewed.
- [ ] The gate is expressed once, beside `applicant_intake_market_by_slug`, not per call site.
- [ ] The endpoint refuses on a CSV market, so a hidden button is not the only rule.
